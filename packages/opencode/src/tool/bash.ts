import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"
import { Agent } from "@/agent/agent"
import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { Wildcard } from "@/util/wildcard"
import { Permission } from "@/permission"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import path from "path"
import { iife } from "@/util/iife"
import { getBackgroundProcessManager } from "@/shell/background"
import { Shell } from "@/shell/shell"

const MAX_OUTPUT_LENGTH = Flag.OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH || 30_000
const SIGKILL_TIMEOUT_MS = 200
const DEFAULT_WAIT_SECONDS = 5
const MAX_WAIT_SECONDS = 600
const FAST_FAILURE_CHECK_MS = 1000 // 1 second

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells

// Helper function to format output with metadata
function formatOutput(
  output: string,
  metadata: {
    truncated?: boolean
    aborted?: boolean
    movedToBackground?: boolean
    pid?: number
    exitCode?: number | null
  },
): string {
  let result = output
  const tags: string[] = []

  if (metadata.truncated) {
    tags.push(`bash tool truncated output as it exceeded ${MAX_OUTPUT_LENGTH} char limit`)
  }

  if (metadata.aborted) {
    tags.push("User aborted the command")
  }

  if (metadata.movedToBackground && metadata.pid) {
    tags.push(`Command exceeded wait time and was moved to background with PID: ${metadata.pid}`)
    tags.push(`Use process_output tool with pid=${metadata.pid} to retrieve output`)
    tags.push(`Use kill ${metadata.pid} bash command to terminate the process`)
  }

  // Add exit code to output if non-zero (but not for backgrounded processes that are still running)
  if (!metadata.movedToBackground && metadata.exitCode !== null && metadata.exitCode !== 0) {
    tags.push(`command exited with code ${metadata.exitCode}`)
  }

  if (tags.length > 0) {
    result += "\n\n<bash_metadata>\n" + tags.join("\n") + "\n</bash_metadata>"
  }

  return result
}

export const BashTool = Tool.define("bash", async () => {
  const shell = iife(() => {
    const s = process.env.SHELL
    if (!s) return process.platform === "win32" ? true : "/bin/bash"
    return s
  })
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
      wait: z
        .number()
        .min(0)
        .describe(
          "Seconds to wait before moving command to background (default: 5, max: 600). Use wait=0 for immediate backgrounding. Background processes run indefinitely. Use process_output and process_input tools to interact with background processes.",
        )
        .optional(),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory

      // Clamp wait parameter silently
      const waitSeconds =
        params.wait !== undefined ? Math.max(0, Math.min(params.wait, MAX_WAIT_SECONDS)) : DEFAULT_WAIT_SECONDS
      const waitMs = waitSeconds * 1000

      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const agent = await Agent.get(ctx.agent)

      const validateDirectoryPermissions = async (dir: string) => {
        if (Filesystem.contains(Instance.directory, dir)) return
        const title = `This command references paths outside of ${Instance.directory}`
        if (agent.permission.external_directory === "ask") {
          await Permission.ask({
            type: "external_directory",
            pattern: [dir, path.join(dir, "*")],
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            callID: ctx.callID,
            title,
            metadata: {
              command: params.command,
            },
          })
        } else if (agent.permission.external_directory === "deny") {
          throw new Permission.RejectedError(
            ctx.sessionID,
            "external_directory",
            ctx.callID,
            {
              command: params.command,
            },
            `${title} so this command is not allowed to be executed.`,
          )
        }
      }

      await validateDirectoryPermissions(cwd)

      const permissions = agent.permission.bash

      const askPatterns = new Set<string>()
      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue
        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = await $`realpath ${arg}`
              .quiet()
              .nothrow()
              .text()
              .then((x) => x.trim())
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              // Git Bash on Windows returns Unix-style paths like /c/Users/...
              const normalized =
                process.platform === "win32" && resolved.match(/^\/[a-z]\//)
                  ? resolved.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
                  : resolved

              await validateDirectoryPermissions(normalized)
            }
          }
        }

        // always allow cd if it passes above check
        if (command[0] !== "cd") {
          const action = Wildcard.allStructured({ head: command[0], tail: command.slice(1) }, permissions)
          if (action === "deny") {
            throw new Error(
              `The user has specifically restricted access to this command: "${command.join(" ")}", you are not allowed to execute it. The user has these settings configured: ${JSON.stringify(permissions)}`,
            )
          }
          if (action === "ask") {
            const pattern = (() => {
              if (command.length === 0) return
              const head = command[0]
              // Find first non-flag argument as subcommand
              const sub = command.slice(1).find((arg) => !arg.startsWith("-"))
              return sub ? `${head} ${sub} *` : `${head} *`
            })()
            if (pattern) {
              askPatterns.add(pattern)
            }
          }
        }
      }

      if (askPatterns.size > 0) {
        const patterns = Array.from(askPatterns)
        await Permission.ask({
          type: "bash",
          pattern: patterns,
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          title: params.command,
          metadata: {
            command: params.command,
            patterns,
          },
        })
      }

      // **EXPLICIT BACKGROUND MODE** - wait: 0
      if (waitSeconds === 0) {
        const manager = getBackgroundProcessManager()
        const { pid, process: bgProcess } = manager.start(params.command, cwd, ctx.sessionID, shell)

        // Initialize metadata streaming
        ctx.metadata({
          metadata: {
            output: "",
            description: params.description,
            pid,
          },
        })

        // Wait up to 1 second for fast failures, but return immediately if process exits
        await Promise.race([bgProcess.wait(), Bun.sleep(FAST_FAILURE_CHECK_MS)])

        if (bgProcess.exitError) {
          throw bgProcess.exitError
        }

        if (bgProcess.status === "completed") {
          const info = bgProcess.getInfo()
          const output = (info.stdout + info.stderr).trim()

          // Stream final output
          ctx.metadata({
            metadata: {
              output,
              description: params.description,
              pid,
            },
          })

          if (info.exitCode !== null && info.exitCode !== 0) {
            throw new Error(
              `Background process ${pid} failed during fast-failure check with exit code ${info.exitCode}\n\n${output}`,
            )
          }
        }

        const output = `Background process started with PID: ${pid}\n\nUse the following tools to interact with this process:\n- process_output: Retrieve output and status\n- process_input: Send input to the process\n- kill ${pid}: Terminate the process`

        return {
          title: params.description,
          metadata: {
            output,
            description: params.description,
            pid,
            exit: null,
          },
          output,
        }
      }

      // **AUTO-BACKGROUND MODE** - Run for waitMs, then background if still running
      const startTime = Date.now() // Track original start time
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""
      const combinedOutput: Array<{
        timestamp: number
        stream: "stdout" | "stderr"
        text: string
      }> = []

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        if (output.length <= MAX_OUTPUT_LENGTH) {
          output += chunk.toString()
          ctx.metadata({
            metadata: {
              output,
              description: params.description,
            },
          })
        }
      }

      const appendStdout = (chunk: Buffer) => {
        const text = chunk.toString()
        append(chunk)
        combinedOutput.push({
          timestamp: Date.now(),
          stream: "stdout",
          text,
        })
      }

      const appendStderr = (chunk: Buffer) => {
        const text = chunk.toString()
        append(chunk)
        combinedOutput.push({
          timestamp: Date.now(),
          stream: "stderr",
          text,
        })
      }

      proc.stdout?.on("data", appendStdout)
      proc.stderr?.on("data", appendStderr)

      let aborted = false
      let exited = false
      let movedToBackground = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      // Auto-background timer
      let autoBackgroundResolver: (() => void) | null = null
      const autoBackgroundTimer = setTimeout(() => {
        if (!exited && !aborted) {
          movedToBackground = true
          log.info("moving command to background", { command: params.command, waitSeconds })
          if (autoBackgroundResolver) {
            autoBackgroundResolver()
          }
        }
      }, waitMs)

      await new Promise<void>((resolve, reject) => {
        // Store resolver for auto-background
        autoBackgroundResolver = resolve

        const cleanup = () => {
          clearTimeout(autoBackgroundTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
          autoBackgroundResolver = null
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      // If we triggered auto-background but process hasn't exited, move to background
      if (movedToBackground && !exited) {
        // Clean up bash.ts listeners BEFORE adopting to prevent duplicate listening
        proc.stdout?.removeAllListeners("data")
        proc.stderr?.removeAllListeners("data")
        proc.removeAllListeners("exit")
        proc.removeAllListeners("error")
        ctx.abort.removeEventListener("abort", abortHandler)

        // Background processes run indefinitely until completion or termination

        // Adopt the existing process (DON'T kill it or restart!)
        const manager = getBackgroundProcessManager()
        const { pid } = manager.adopt(
          proc, // The running process
          params.command, // Command for reference
          cwd, // Working directory
          ctx.sessionID, // Session ID
          startTime, // Original start time (CRITICAL: preserves timing)
          output, // Accumulated stdout from first 10s
          "", // Accumulated stderr (empty - we capture both in output)
          combinedOutput, // Combined output with timestamps
        )

        // Set up abort handling for background process
        if (!ctx.abort.aborted) {
          const bgAbortHandler = () => manager.kill(pid)
          ctx.abort.addEventListener("abort", bgAbortHandler)
        }

        const finalOutput = formatOutput(output, { movedToBackground: true, pid })

        // Stream final metadata with background info
        ctx.metadata({
          metadata: {
            output: finalOutput,
            description: params.description,
            pid,
          },
        })

        return {
          title: params.description,
          metadata: {
            output: finalOutput,
            description: params.description,
            pid,
            exit: null,
          },
          output: finalOutput,
        }
      }

      // Normal synchronous completion
      const truncated = output.length > MAX_OUTPUT_LENGTH
      if (truncated) {
        output = output.slice(0, MAX_OUTPUT_LENGTH)
      }

      const finalOutput = formatOutput(output, {
        truncated,
        aborted,
        exitCode: proc.exitCode,
      })

      return {
        title: params.description,
        metadata: {
          output: finalOutput,
          description: params.description,
          pid: 0,
          exit: proc.exitCode,
        },
        output: finalOutput,
      }
    },
  }
})
