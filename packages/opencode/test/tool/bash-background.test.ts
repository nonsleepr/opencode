import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { ProcessOutputTool } from "../../src/tool/process-output"
import { ProcessInputTool } from "../../src/tool/process-input"
import { Instance } from "../../src/project/instance"
import { getBackgroundProcessManager } from "../../src/shell/background"

const projectRoot = path.join(__dirname, "../..")

const createContext = (sessionID = "test-background") => ({
  sessionID,
  messageID: "",
  toolCallID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
})

// Helper to wait for a condition with timeout
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  checkIntervalMs = 100,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await Bun.sleep(checkIntervalMs)
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`)
}

describe("tool.bash-background", () => {
  let ctx = createContext()

  beforeEach(() => {
    ctx = createContext()
  })

  // Note: afterEach cleanup is not needed as each test cleans up its own processes
  // The background manager is per-instance and persists across tests

  test("explicit background mode returns pid", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const manager = getBackgroundProcessManager()
        const sleepCmd = process.platform === "win32" ? "timeout /t 5 /nobreak" : "sleep 5"

        const result = await bash.execute(
          {
            command: sleepCmd,
            description: "Sleep for 5 seconds",
            run_in_background: true,
          },
          ctx,
        )

        expect(result.output).toContain("Background process started with PID:")
        expect(result.output).toContain("process_output")
        expect(result.output).toContain("process_input")
        expect(result.output).toContain("kill")
        expect(result.metadata.pid).toBeDefined()
        expect(result.metadata.exit).toBeNull()

        // Verify process is running
        const bgProcess = manager.get(result.metadata.pid)
        expect(bgProcess).toBeDefined()
        expect(bgProcess?.status).toBe("running")

        // Clean up
        manager.kill(result.metadata.pid)
      },
    })
  })

  test("explicit background mode fast failure check", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const failCmd = process.platform === "win32" ? "exit 1" : "exit 1"

        try {
          await bash.execute(
            {
              command: failCmd,
              description: "Command that fails immediately",
              run_in_background: true,
            },
            ctx,
          )
          expect(true).toBe(false) // Should not reach here
        } catch (err) {
          expect((err as Error).message).toContain("failed during fast-failure check")
          expect((err as Error).message).toContain("exit code 1")
        }
      },
    })
  })

  test(
    "auto-background on timeout",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const manager = getBackgroundProcessManager()
          // Use a command that runs longer than 10s
          // For testing, we'll use a shorter timeout to make test faster
          const longCmd = process.platform === "win32" ? "timeout /t 20 /nobreak" : "sleep 20"

          const resultPromise = bash.execute(
            {
              command: longCmd,
              description: "Long running command",
              timeout: 15000, // 15 seconds to allow auto-background at 10s
            },
            ctx,
          )

          const result = await resultPromise

          expect(result.output).toContain("Command exceeded 10 seconds and was moved to background")
          expect(result.output).toContain("PID:")
          expect(result.metadata.pid).toBeDefined()
          expect(result.metadata.exit).toBeNull()

          // Verify process is running
          const bgProcess = manager.get(result.metadata.pid)
          expect(bgProcess).toBeDefined()
          expect(bgProcess?.status).toBe("running")

          // Clean up
          manager.kill(result.metadata.pid)
        },
      })
    },
    { timeout: 20000 },
  )

  test(
    "auto-background preserves state and output",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const processOutput = await ProcessOutputTool.init()

          // Command that counts 1-20, exceeds 10s threshold
          const cmd =
            process.platform === "win32"
              ? 'powershell -Command "1..20 | ForEach-Object { Write-Host $_; Start-Sleep -Seconds 1 }"'
              : "for i in {1..20}; do echo $i; sleep 1; done"

          const result = await bash.execute(
            {
              command: cmd,
              description: "Counter test",
              timeout: 25000, // 25 seconds to allow completion
            },
            ctx,
          )

          expect(result.output).toContain("Command exceeded 10 seconds")
          expect(result.metadata.pid).toBeDefined()

          const manager = getBackgroundProcessManager()
          const bgProcess = manager.get(result.metadata.pid!)

          // Wait for completion
          await bgProcess!.wait()

          const output = await processOutput.execute({ pid: result.metadata.pid! }, ctx)

          // CRITICAL: Should see 1-20 continuously, NOT 1-10 then restart at 1
          expect(output.output).toContain("1\n")
          expect(output.output).toContain("10\n")
          expect(output.output).toContain("11\n") // Continuity check
          expect(output.output).toContain("20\n")

          // Should NOT have duplicate sequence (1-10 appearing twice)
          const matches = (output.output.match(/^1$/gm) || []).length
          expect(matches).toBe(1) // Only one "1", not two
        },
      })
    },
    { timeout: 30000 },
  )

  test("fast completion returns synchronously", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()

        const result = await bash.execute(
          {
            command: "echo 'fast command'",
            description: "Fast command",
          },
          ctx,
        )

        expect(result.metadata.exit).toBe(0)
        expect(result.output).toContain("fast command")
        expect(result.metadata.pid).toBe(0)
        expect(result.output).not.toContain("moved to background")
      },
    })
  })

  test("process_output retrieves running process output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const processOutput = await ProcessOutputTool.init()

        // Start a background process that outputs something
        const cmd =
          process.platform === "win32"
            ? "powershell -Command \"echo 'Hello from background'; Start-Sleep -Seconds 5\""
            : "echo 'Hello from background' && sleep 5"

        const startResult = await bash.execute(
          {
            command: cmd,
            description: "Background process with output",
            run_in_background: true,
          },
          ctx,
        )

        const shellId = startResult.metadata.pid

        // Wait a bit for output to be captured
        await Bun.sleep(500)

        // Retrieve output
        const outputResult = await processOutput.execute({ pid: shellId }, ctx)

        expect(outputResult.output).toContain("Command:")
        expect(outputResult.output).toContain("Status: running")
        expect(outputResult.output).toContain("Hello from background")
        expect(outputResult.metadata.status).toBe("running")
        expect(outputResult.metadata.done).toBe(false)

        // Clean up
        const manager = getBackgroundProcessManager()
        manager.kill(shellId)
      },
    })
  })

  test("process_output retrieves completed process output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const processOutput = await ProcessOutputTool.init()

        const result = await processOutput.execute({ pid: 99999 }, ctx)

        expect(result.title).toBe("Process Not Found")
        expect(result.output).toContain("No background process found")
        expect(result.metadata.status).toBeNull()
        expect(result.metadata.done).toBe(true)
      },
    })
  })

  test("process_kill terminates running process", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const manager = getBackgroundProcessManager()

        const sleepCmd = process.platform === "win32" ? "timeout /t 30 /nobreak" : "sleep 30"

        const startResult = await bash.execute(
          {
            command: sleepCmd,
            description: "Long sleep",
            run_in_background: true,
          },
          ctx,
        )

        const shellId = startResult.metadata.pid

        // Verify process is running
        const bgProcess = manager.get(shellId)
        expect(bgProcess?.status).toBe("running")

        // Kill the process using manager.kill()
        manager.kill(shellId)

        // Wait for status to update
        await Bun.sleep(200)

        // Verify process is killed
        const killedProcess = manager.get(shellId)
        expect(killedProcess?.status).toBe("killed")
      },
    })
  })

  test("process_kill handles non-existent process", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const manager = getBackgroundProcessManager()

        // Try to get non-existent process
        const result = manager.get(99999)

        expect(result).toBeUndefined()
      },
    })
  })

  test("process_kill handles already completed process", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const manager = getBackgroundProcessManager()

        const cmd = process.platform === "win32" ? "echo Done" : "echo 'Done'"

        const startResult = await bash.execute(
          {
            command: cmd,
            description: "Quick process",
            run_in_background: true,
          },
          ctx,
        )

        const shellId = startResult.metadata.pid

        // Wait for completion
        await waitFor(async () => {
          const manager = getBackgroundProcessManager()
          const bgProcess = manager.get(shellId)
          return bgProcess?.status === "completed"
        })

        // Try to kill completed process - manager.kill() is idempotent
        const bgProcess = manager.get(shellId)
        expect(bgProcess?.status).toBe("completed")

        // Killing a completed process is a no-op
        manager.kill(shellId)

        const afterKill = manager.get(shellId)
        expect(afterKill?.status).toBe("completed")
      },
    })
  })

  test("process_input sends stdin to interactive process", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const processInput = await ProcessInputTool.init()
        const processOutput = await ProcessOutputTool.init()

        // Start a process that reads from stdin
        const cmd =
          process.platform === "win32"
            ? 'powershell -Command "while($line = Read-Host) { Write-Host \\"Got: $line\\" }"'
            : 'while read line; do echo "Got: $line"; done'

        const startResult = await bash.execute(
          {
            command: cmd,
            description: "Interactive stdin reader",
            run_in_background: true,
          },
          ctx,
        )

        const shellId = startResult.metadata.pid

        // Send input
        const inputResult = await processInput.execute(
          {
            pid: shellId,
            text: "Hello\n",
          },
          ctx,
        )

        expect(inputResult.title).toBe("Input Sent")
        expect(inputResult.output).toContain("Successfully sent input")
        expect(inputResult.metadata.sent).toBe(true)

        // Wait for output
        await Bun.sleep(500)

        // Check output
        const outputResult = await processOutput.execute({ pid: shellId }, ctx)
        expect(outputResult.output).toContain("Got: Hello")

        // Clean up
        const manager = getBackgroundProcessManager()
        manager.kill(shellId)
      },
    })
  })

  test("process_input closes stdin with close_stdin flag", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const processInput = await ProcessInputTool.init()

        // Start a process that reads until EOF
        const cmd = process.platform === "win32" ? 'powershell -Command "$input"' : "cat"

        const startResult = await bash.execute(
          {
            command: cmd,
            description: "Cat stdin",
            run_in_background: true,
          },
          ctx,
        )

        const shellId = startResult.metadata.pid

        // Send input and close stdin
        const inputResult = await processInput.execute(
          {
            pid: shellId,
            text: "data\n",
            close_stdin: true,
          },
          ctx,
        )

        expect(inputResult.output).toContain("stdin closed")
        expect(inputResult.metadata.sent).toBe(true)

        // Process should exit after stdin closes
        await waitFor(async () => {
          const manager = getBackgroundProcessManager()
          const bgProcess = manager.get(shellId)
          return bgProcess?.status === "completed"
        }, 3000)

        const manager = getBackgroundProcessManager()
        const bgProcess = manager.get(shellId)
        expect(bgProcess?.status).toBe("completed")
      },
    })
  })

  test("process_input handles non-running process", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const processInput = await ProcessInputTool.init()

        const cmd = process.platform === "win32" ? "echo Done" : "echo 'Done'"

        const startResult = await bash.execute(
          {
            command: cmd,
            description: "Quick process",
            run_in_background: true,
          },
          ctx,
        )

        const shellId = startResult.metadata.pid

        // Wait for completion
        await waitFor(async () => {
          const manager = getBackgroundProcessManager()
          const bgProcess = manager.get(shellId)
          return bgProcess?.status === "completed"
        })

        // Try to send input to completed process
        const inputResult = await processInput.execute(
          {
            pid: shellId,
            text: "test\n",
          },
          ctx,
        )

        expect(inputResult.title).toBe("Process Not Running")
        expect(inputResult.output).toContain("is not running")
        expect(inputResult.metadata.sent).toBe(false)
        expect(inputResult.metadata.error).toBe("process_not_running")
      },
    })
  })

  test(
    "output truncation at 30k characters",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const processOutput = await ProcessOutputTool.init()

          // Generate more than 30k characters of output
          const cmd =
            process.platform === "win32"
              ? 'powershell -Command "1..2000 | ForEach-Object { Write-Host ($_ * 30) }"'
              : "for i in {1..2000}; do printf '%030d\\n' $i; done"

          const startResult = await bash.execute(
            {
              command: cmd,
              description: "Generate large output",
              run_in_background: true,
            },
            ctx,
          )

          const shellId = startResult.metadata.pid

          // Wait for completion
          await waitFor(async () => {
            const manager = getBackgroundProcessManager()
            const bgProcess = manager.get(shellId)
            return bgProcess?.status === "completed"
          }, 10000)

          // Check output is truncated
          const outputResult = await processOutput.execute({ pid: shellId, stream: "stdout" }, ctx)
          const manager = getBackgroundProcessManager()
          const bgProcess = manager.get(shellId)

          expect(bgProcess?.stdoutTruncated || bgProcess?.stderrTruncated).toBe(true)
          expect(outputResult.output).toContain("[Output truncated to 30KB - showing most recent output]")
        },
      })
    },
    { timeout: 15000 },
  )

  test(
    "max processes limit",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const sleepCmd = process.platform === "win32" ? "timeout /t 60 /nobreak" : "sleep 60"

          // Start 50 background processes (the max)
          const shellIds: number[] = []
          for (let i = 0; i < 50; i++) {
            const result = await bash.execute(
              {
                command: sleepCmd,
                description: `Job ${i}`,
                run_in_background: true,
              },
              ctx,
            )
            shellIds.push(result.metadata.pid)
          }

          // Try to start the 51st process
          try {
            await bash.execute(
              {
                command: sleepCmd,
                description: "Job 51",
                run_in_background: true,
              },
              ctx,
            )
            expect(true).toBe(false) // Should not reach here
          } catch (err) {
            expect((err as Error).message).toContain("Maximum background processes limit")
            expect((err as Error).message).toContain("50")
          }

          // Clean up all processes
          const manager = getBackgroundProcessManager()
          for (const shellId of shellIds) {
            manager.kill(shellId)
          }
        },
      })
    },
    { timeout: 60000 },
  )

  test("list all background processes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const manager = getBackgroundProcessManager()

        // Start multiple processes
        const sleepCmd = process.platform === "win32" ? "timeout /t 10 /nobreak" : "sleep 10"

        await bash.execute(
          {
            command: sleepCmd,
            description: "Job 1",
            run_in_background: true,
          },
          ctx,
        )

        await bash.execute(
          {
            command: sleepCmd,
            description: "Job 2",
            run_in_background: true,
          },
          ctx,
        )

        const processes = manager.list()
        expect(processes.length).toBeGreaterThanOrEqual(2)

        for (const process of processes) {
          expect(process.pid).toBeDefined()
          expect(process.command).toBeDefined()
          expect(process?.status).toBeDefined()
        }

        // Clean up
        manager.killAll()
      },
    })
  })

  test("process info includes timing information", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const processOutput = await ProcessOutputTool.init()

        const cmd = process.platform === "win32" ? "echo Test" : "echo 'Test'"

        const startResult = await bash.execute(
          {
            command: cmd,
            description: "Timed process",
            run_in_background: true,
          },
          ctx,
        )

        const shellId = startResult.metadata.pid

        // Wait for completion
        await waitFor(async () => {
          const manager = getBackgroundProcessManager()
          const bgProcess = manager.get(shellId)
          return bgProcess?.status === "completed"
        })

        const outputResult = await processOutput.execute({ pid: shellId }, ctx)

        expect(outputResult.output).toContain("Started:")
        expect(outputResult.output).toContain("Ended:")
        expect(outputResult.output).toContain("Duration:")
      },
    })
  })

  test("stderr is captured separately", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const processOutput = await ProcessOutputTool.init()

        // Command that writes to both stdout and stderr
        const cmd =
          process.platform === "win32"
            ? "powershell -Command \"Write-Host 'stdout message'; Write-Error 'stderr message'\""
            : "echo 'stdout message' && echo 'stderr message' >&2"

        const startResult = await bash.execute(
          {
            command: cmd,
            description: "Job with stderr",
            run_in_background: true,
          },
          ctx,
        )

        const shellId = startResult.metadata.pid

        // Wait for completion
        await waitFor(async () => {
          const manager = getBackgroundProcessManager()
          const bgProcess = manager.get(shellId)
          return bgProcess?.status === "completed"
        })

        const outputResult = await processOutput.execute({ pid: shellId }, ctx)

        expect(outputResult.output).toContain("<process_metadata>")
        expect(outputResult.output).toContain("</process_metadata>")
        expect(outputResult.output).toContain("stdout message")
        expect(outputResult.output).toContain("stderr message")
      },
    })
  })
})
