import { spawn, ChildProcess } from "child_process"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"

const log = Log.create({ service: "background-processes" })

// Constants
const MAX_BACKGROUND_PROCESSES = 50
const MAX_OUTPUT_PER_STREAM = 30_000

// Bus event definitions
export const BackgroundProcessStarted = BusEvent.define(
  "background.process.started",
  z.object({
    pid: z.number(),
    command: z.string(),
    workdir: z.string(),
  }),
)

export const BackgroundProcessCompleted = BusEvent.define(
  "background.process.completed",
  z.object({
    pid: z.number(),
    exitCode: z.number().nullable(),
    signal: z.string().nullable(),
  }),
)

export const BackgroundProcessKilled = BusEvent.define(
  "background.process.killed",
  z.object({
    pid: z.number(),
  }),
)

export type ProcessStatus = "running" | "completed" | "killed"

export const ProcessInfoSchema = z.object({
  pid: z.number(),
  command: z.string(),
  workdir: z.string(),
  sessionID: z.string(),
  status: z.enum(["running", "completed", "killed"]),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  combined: z.string(),
  startTime: z.number(),
  endTime: z.number().nullable(),
})

export interface ProcessInfo {
  pid: number
  command: string
  workdir: string
  sessionID: string
  status: ProcessStatus
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  combined: string
  startTime: number
  endTime: number | null
}

class BackgroundProcess {
  public readonly sessionID: string
  command: string
  workdir: string
  process: ChildProcess
  status: ProcessStatus = "running"
  exitCode: number | null = null
  signal: string | null = null
  stdout: string = ""
  stderr: string = ""
  stdoutTruncated: boolean = false
  stderrTruncated: boolean = false
  startTime: number
  endTime: number | null = null
  exitError: Error | null = null
  private combinedOutput: Array<{
    timestamp: number
    stream: "stdout" | "stderr"
    text: string
  }> = []
  private combinedTruncated: boolean = false

  constructor(
    command: string,
    workdir: string,
    sessionID: string,
    process: ChildProcess,
    options?: {
      startTime?: number
      initialStdout?: string
      initialStderr?: string
      initialCombinedOutput?: Array<{
        timestamp: number
        stream: "stdout" | "stderr"
        text: string
      }>
    },
  ) {
    this.command = command
    this.workdir = workdir
    this.sessionID = sessionID
    this.process = process
    this.startTime = options?.startTime || Date.now()

    // Initialize with accumulated output BEFORE setting up handlers
    this.stdout = options?.initialStdout || ""
    this.stderr = options?.initialStderr || ""
    this.combinedOutput = options?.initialCombinedOutput || []

    // Setup output buffering with rolling window
    process.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      // Always append new output
      this.stdout += text

      // If exceeds limit, trim from the beginning (rolling window)
      if (this.stdout.length > MAX_OUTPUT_PER_STREAM) {
        const excess = this.stdout.length - MAX_OUTPUT_PER_STREAM
        this.stdout = this.stdout.slice(excess)
        this.stdoutTruncated = true
      }

      // Also store in combined buffer with timestamp
      this.combinedOutput.push({
        timestamp: Date.now(),
        stream: "stdout",
        text: text,
      })

      // Truncate combined buffer if exceeds limit (60k total for both streams)
      const totalSize = this.combinedOutput.reduce((sum, entry) => sum + entry.text.length, 0)
      if (totalSize > MAX_OUTPUT_PER_STREAM * 2) {
        // Keep removing oldest entries until under limit
        while (
          this.combinedOutput.length > 0 &&
          this.combinedOutput.reduce((sum, e) => sum + e.text.length, 0) > MAX_OUTPUT_PER_STREAM * 2
        ) {
          this.combinedOutput.shift()
          this.combinedTruncated = true
        }
      }
    })

    process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      // Always append new output
      this.stderr += text

      // If exceeds limit, trim from the beginning (rolling window)
      if (this.stderr.length > MAX_OUTPUT_PER_STREAM) {
        const excess = this.stderr.length - MAX_OUTPUT_PER_STREAM
        this.stderr = this.stderr.slice(excess)
        this.stderrTruncated = true
      }

      // Also store in combined buffer with timestamp
      this.combinedOutput.push({
        timestamp: Date.now(),
        stream: "stderr",
        text: text,
      })

      // Truncate combined buffer if exceeds limit (60k total for both streams)
      const totalSize = this.combinedOutput.reduce((sum, entry) => sum + entry.text.length, 0)
      if (totalSize > MAX_OUTPUT_PER_STREAM * 2) {
        // Keep removing oldest entries until under limit
        while (
          this.combinedOutput.length > 0 &&
          this.combinedOutput.reduce((sum, e) => sum + e.text.length, 0) > MAX_OUTPUT_PER_STREAM * 2
        ) {
          this.combinedOutput.shift()
          this.combinedTruncated = true
        }
      }
    })

    // Handle process exit
    process.on("exit", (code, signal) => {
      this.exitCode = code
      this.signal = signal
      // If we're killing, status was already set to "killed", don't override
      if (this.status !== "killed") {
        this.status = "completed"
      }
      this.endTime = Date.now()
      log.info("background process completed", {
        pid: this.process.pid,
        exitCode: code,
        signal,
      })
      Bus.publish(BackgroundProcessCompleted, {
        pid: this.process.pid!,
        exitCode: code,
        signal: signal || null,
      })
    })

    // Handle spawn errors
    process.on("error", (err) => {
      this.exitError = err
      log.error("background process spawn error", {
        pid: this.process.pid,
        error: err,
      })
    })
  }

  getInfo(): ProcessInfo {
    return {
      pid: this.process.pid!,
      command: this.command,
      workdir: this.workdir,
      sessionID: this.sessionID,
      status: this.status,
      exitCode: this.exitCode,
      signal: this.signal,
      stdout: this.stdout + (this.stdoutTruncated ? "\n[Output truncated to 30KB - showing most recent output]" : ""),
      stderr: this.stderr + (this.stderrTruncated ? "\n[Output truncated to 30KB - showing most recent output]" : ""),
      combined: this.getCombinedOutput(),
      startTime: this.startTime,
      endTime: this.endTime,
    }
  }

  private getCombinedOutput(): string {
    if (this.combinedOutput.length === 0) {
      return ""
    }

    // Sort by timestamp to ensure chronological order
    // (handles any buffering differences between stdout/stderr)
    const sorted = [...this.combinedOutput].sort((a, b) => a.timestamp - b.timestamp)
    const output = sorted.map((entry) => entry.text).join("")

    if (this.combinedTruncated) {
      return output + "\n[Combined output truncated at 60k characters]"
    }

    return output
  }

  sendInput(text: string): boolean {
    if (this.status !== "running") {
      log.warn("attempted to send input to non-running process", { pid: this.process.pid })
      return false
    }
    if (!this.process.stdin || this.process.stdin.destroyed) {
      log.warn("stdin unavailable for process", { pid: this.process.pid })
      return false
    }
    try {
      return this.process.stdin.write(text)
    } catch (err) {
      log.error("failed to write to stdin", { pid: this.process.pid, error: err })
      return false
    }
  }

  kill(): void {
    if (this.status !== "running") {
      log.info("kill called on non-running process, ignoring", { pid: this.process.pid })
      return
    }

    this.status = "killed"
    log.info("killing background process", { pid: this.process.pid })

    // Cross-platform process tree killing
    const pid = this.process.pid
    if (!pid) {
      log.warn("no pid for process, cannot kill", { pid: this.process.pid })
      return
    }

    try {
      if (process.platform === "win32") {
        // Windows: use taskkill with /T flag to kill process tree
        spawn("taskkill", ["/pid", pid.toString(), "/T", "/F"], {
          stdio: "ignore",
        })
      } else {
        // Unix: kill process group (negative pid)
        process.kill(-pid, "SIGKILL")
      }
    } catch (err) {
      log.error("failed to kill process", { pid: this.process.pid, error: err })
    }

    Bus.publish(BackgroundProcessKilled, {
      pid: this.process.pid!,
    })
  }

  wait(): Promise<void> {
    return new Promise((resolve) => {
      if (this.status !== "running") {
        resolve()
        return
      }
      this.process.once("exit", () => resolve())
    })
  }
}

class BackgroundProcessManager {
  private processes = new Map<number, BackgroundProcess>()

  start(
    command: string,
    workdir: string,
    sessionID: string,
    shell: string | boolean,
  ): { pid: number; process: BackgroundProcess } {
    // Check max processes limit
    const runningCount = Array.from(this.processes.values()).filter((p) => p.status === "running").length
    if (runningCount >= MAX_BACKGROUND_PROCESSES) {
      throw new Error(`Maximum background processes limit (${MAX_BACKGROUND_PROCESSES}) reached`)
    }

    log.info("starting background process", { command, workdir })

    // Spawn process with same logic as bash tool
    const shellCmd = typeof shell === "string" ? shell : command
    const shellArgs = typeof shell === "string" ? ["-c", command] : []
    const proc = spawn(shellCmd, shellArgs, {
      cwd: workdir,
      stdio: ["pipe", "pipe", "pipe"], // Enable stdin for interactive input
      detached: process.platform !== "win32", // Create process group on Unix
      env: {
        ...process.env,
        FORCE_COLOR: "1",
      },
    })

    const bgProcess = new BackgroundProcess(command, workdir, sessionID, proc)
    this.processes.set(proc.pid!, bgProcess)

    Bus.publish(BackgroundProcessStarted, {
      pid: proc.pid!,
      command,
      workdir,
    })

    return { pid: proc.pid!, process: bgProcess }
  }

  /**
   * Adopt an existing running process into background management.
   * Used by auto-background to transfer processes without restarting.
   */
  adopt(
    process: ChildProcess,
    command: string,
    workdir: string,
    sessionID: string,
    startTime: number,
    accumulatedStdout: string = "",
    accumulatedStderr: string = "",
    accumulatedCombinedOutput: Array<{
      timestamp: number
      stream: "stdout" | "stderr"
      text: string
    }> = [],
  ): { pid: number; process: BackgroundProcess } {
    const runningCount = Array.from(this.processes.values()).filter((p) => p.status === "running").length

    if (runningCount >= MAX_BACKGROUND_PROCESSES) {
      throw new Error(`Maximum background processes limit (${MAX_BACKGROUND_PROCESSES}) reached`)
    }

    log.info("adopting existing process", {
      command,
      workdir,
      pid: process.pid,
      startTime,
      accumulatedOutputLength: accumulatedStdout.length + accumulatedStderr.length,
    })

    const bgProcess = new BackgroundProcess(command, workdir, sessionID, process, {
      startTime,
      initialStdout: accumulatedStdout,
      initialStderr: accumulatedStderr,
      initialCombinedOutput: accumulatedCombinedOutput,
    })

    this.processes.set(process.pid!, bgProcess)

    Bus.publish(BackgroundProcessStarted, { pid: process.pid!, command, workdir })

    // Auto-cleanup on completion
    bgProcess.wait().then(() => {
      Bus.publish(BackgroundProcessCompleted, {
        pid: bgProcess.process.pid!,
        exitCode: bgProcess.exitCode,
        signal: bgProcess.signal,
      })
    })

    return { pid: process.pid!, process: bgProcess }
  }

  get(pid: number): BackgroundProcess | undefined {
    return this.processes.get(pid)
  }

  list(): ProcessInfo[] {
    return Array.from(this.processes.values()).map((process) => process.getInfo())
  }

  listProcessesBySession(sessionID: string): BackgroundProcess[] {
    return Array.from(this.processes.values()).filter((process) => process.sessionID === sessionID)
  }

  kill(pid: number): void {
    const process = this.processes.get(pid)
    if (!process) {
      log.warn("attempted to kill non-existent process", { pid })
      return
    }
    process.kill()
  }

  sendInput(pid: number, text: string): void {
    const process = this.processes.get(pid)
    if (!process) {
      log.warn("attempted to send input to non-existent process", { pid })
      return
    }
    process.sendInput(text)
  }

  killAll(): void {
    log.info("killing all background processes")
    for (const process of this.processes.values()) {
      if (process.status === "running") {
        process.kill()
      }
    }
  }

  dispose(): void {
    log.info("disposing background process manager")
    this.killAll()
    this.processes.clear()
  }
}

// Singleton per instance - state function created once at module level
const state = Instance.state(
  () => {
    return new BackgroundProcessManager()
  },
  async (manager) => {
    manager.dispose()
  },
)

export function getBackgroundProcessManager() {
  return state()
}
