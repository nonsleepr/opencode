import { getBackgroundProcessManager } from "@/shell/background"
import { fn } from "@/util/fn"
import z from "zod"

/**
 * Process namespace containing all process-related operations.
 * Provides access to background process management functionality.
 */
export namespace Process {
  /**
   * List all background processes (running, completed, and killed).
   *
   * @returns Array of ProcessInfo objects containing process metadata
   *
   * @example
   * const processes = await Process.list()
   * const running = processes.filter(p => p.status === "running")
   */
  export const list = fn(z.void(), async () => {
    const manager = getBackgroundProcessManager()
    return manager.list()
  })
}
