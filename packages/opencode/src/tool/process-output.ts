import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./process-output.txt"
import { getBackgroundProcessManager, type ProcessStatus } from "@/shell/background"
import { Log } from "@/util/log"

const log = Log.create({ service: "process-output-tool" })

export const ProcessOutputTool = Tool.define("process_output", {
  description: DESCRIPTION,
  parameters: z.object({
    pid: z.number().describe("The PID of the background process to retrieve output from"),
    stream: z
      .enum(["combined", "stdout", "stderr"])
      .optional()
      .describe(
        "Which output stream(s) to display: 'combined' shows interleaved stdout+stderr (default), 'stdout' shows only stdout, 'stderr' shows only stderr",
      ),
  }),
  async execute(params) {
    const streamMode = params.stream || "combined"
    const manager = getBackgroundProcessManager()
    const bgProcess = manager.get(params.pid)

    if (!bgProcess) {
      log.warn("process not found", { pid: params.pid })
      return {
        title: "Process Not Found",
        output: `No background process found with PID: ${params.pid}\n\nUse the bash tool output to see available process PIDs.`,
        metadata: {
          status: null as ProcessStatus | null,
          exitCode: null,
          signal: null,
          done: true,
        },
      }
    }

    const info = bgProcess.getInfo()
    let result = ""

    // Use stream parameter to determine output format
    if (streamMode === "combined") {
      result = info.combined || "(no output)"
    } else if (streamMode === "stdout") {
      result = info.stdout || "(no output)"
    } else if (streamMode === "stderr") {
      result = info.stderr || "(no output)"
    }

    // Add metadata after output (consistent with bash_metadata pattern)
    const tags: string[] = []
    tags.push(`Command: ${info.command}`)
    tags.push(`Working Directory: ${info.workdir}`)
    tags.push(`Status: ${info.status}`)
    tags.push(`Started: ${new Date(info.startTime).toISOString()}`)

    if (info.endTime) {
      tags.push(`Ended: ${new Date(info.endTime).toISOString()}`)
      const duration = ((info.endTime - info.startTime) / 1000).toFixed(2)
      tags.push(`Duration: ${duration}s`)
    }

    if (info.status === "completed" || info.status === "killed") {
      if (info.exitCode !== null) {
        tags.push(`Exit Code: ${info.exitCode}`)
      }
      if (info.signal) {
        tags.push(`Signal: ${info.signal}`)
      }
    }

    // Always include metadata for process output (provides important context)
    result += "\n\n<process_metadata>\n" + tags.join("\n") + "\n</process_metadata>"

    log.info("retrieved process output", { pid: params.pid, status: info.status, stream: streamMode })

    return {
      title: `Process ${params.pid}`,
      output: result,
      metadata: {
        status: info.status as ProcessStatus | null,
        exitCode: info.exitCode,
        signal: info.signal,
        done: info.status !== "running",
      },
    }
  },
})
