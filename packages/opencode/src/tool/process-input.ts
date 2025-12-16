import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./process-input.txt"
import { getBackgroundProcessManager } from "@/shell/background"
import { Log } from "@/util/log"

const log = Log.create({ service: "process-input-tool" })

export const ProcessInputTool = Tool.define("process_input", {
  description: DESCRIPTION,
  parameters: z.object({
    pid: z.number().describe("The PID of the background process to send input to"),
    text: z.string().describe("The text to send to the process's stdin"),
    close_stdin: z
      .boolean()
      .optional()
      .describe("If true, closes stdin after sending text (sends EOF). Default: false"),
  }),
  async execute(params) {
    const manager = getBackgroundProcessManager()
    const bgProcess = manager.get(params.pid)

    if (!bgProcess) {
      log.warn("process not found for input", { pid: params.pid })
      const result = `No background process found with PID: ${params.pid}\n\nThe process may have already completed or been cleaned up.`
      const tags = ["error: process_not_found", "reason: Process already completed or cleaned up"]
      return {
        title: "Process Not Found",
        output: result + "\n\n<process_metadata>\n" + tags.join("\n") + "\n</process_metadata>",
        metadata: {
          sent: false,
          error: "process_not_found" as string | null,
        },
      }
    }

    const info = bgProcess.getInfo()

    if (info.status !== "running") {
      log.warn("attempted to send input to non-running process", {
        pid: params.pid,
        status: info.status,
      })
      const result = `Cannot send input to process ${params.pid} because it is not running (status: ${info.status}).\n\nOnly running processes can receive input.`
      const tags = ["error: process_not_running", `status: ${info.status}`]
      return {
        title: "Process Not Running",
        output: result + "\n\n<process_metadata>\n" + tags.join("\n") + "\n</process_metadata>",
        metadata: {
          sent: false,
          error: "process_not_running" as string | null,
        },
      }
    }

    const success = bgProcess.sendInput(params.text)

    if (!success) {
      log.error("failed to send input to process", { pid: params.pid })
      const result = `Failed to send input to process ${params.pid}.\n\nStdin may be closed or unavailable.`
      const tags = ["error: stdin_unavailable", "reason: Stdin may be closed or process ended"]
      return {
        title: "Input Failed",
        output: result + "\n\n<process_metadata>\n" + tags.join("\n") + "\n</process_metadata>",
        metadata: {
          sent: false,
          error: "stdin_unavailable" as string | null,
        },
      }
    }

    if (params.close_stdin) {
      const proc = bgProcess.process
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.end()
        log.info("closed stdin for process", { pid: params.pid })
      }
    }

    const textPreview = params.text.length > 50 ? params.text.slice(0, 50) + "..." : params.text

    const closedNote = params.close_stdin ? " (stdin closed)" : ""

    log.info("sent input to process", {
      pid: params.pid,
      textLength: params.text.length,
      closedStdin: params.close_stdin,
    })

    const result = `Successfully sent input to process ${params.pid}${closedNote}.`
    const tags = [`Text: ${textPreview}`, `Stdin Closed: ${params.close_stdin ? "true" : "false"}`]
    return {
      title: "Input Sent",
      output: result + "\n\n<process_metadata>\n" + tags.join("\n") + "\n</process_metadata>",
      metadata: {
        sent: true,
        error: null as string | null,
      },
    }
  },
})
