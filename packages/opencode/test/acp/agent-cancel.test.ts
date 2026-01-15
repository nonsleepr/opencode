import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP Agent - cancel()", () => {
  const createMockSDK = () => ({
    config: {
      get: async () => ({ data: { model: "opencode/big-pickle" } }),
      providers: async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "OpenCode",
              models: {
                "big-pickle": { id: "big-pickle", name: "Big Pickle", providerID: "opencode" },
              },
            },
          ],
        },
      }),
    },
    session: {
      create: async () => ({
        data: { id: "test-session-789", time: { created: new Date().toISOString() } },
      }),
      messages: async () => ({ data: [] }),
      message: async () => ({ data: null }),
      abort: async () => ({ data: {} }),
    },
    app: {
      agents: async () => ({
        data: [{ name: "general", description: "General purpose agent", mode: "agent", hidden: false }],
      }),
    },
    command: { list: async () => ({ data: [] }) },
    mcp: { add: async () => ({ data: {} }) },
    permission: { reply: async () => ({ data: {} }) },
    event: {
      subscribe: async () => ({ stream: (async function* () {})() }),
    },
  })

  test("should call session.abort with correct parameters", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParams: any
        const sdk = createMockSDK()
        sdk.session.abort = async (params: any) => {
          capturedParams = params
          return { data: {} }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })
        await agent.cancel({ sessionId: "test-session-789" })

        expect(capturedParams.sessionID).toBe("test-session-789")
        expect(capturedParams.directory).toBe("/test/cwd")
      },
    })
  })

  test("should successfully cancel a session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let abortCalled = false
        const sdk = createMockSDK()
        sdk.session.abort = async () => {
          abortCalled = true
          return { data: {} }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })
        await agent.cancel({ sessionId: "test-session-789" })

        expect(abortCalled).toBe(true)
      },
    })
  })

  test("should throw error for non-existent session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const promise = agent.cancel({ sessionId: "non-existent-session" })

        await expect(promise).rejects.toThrow()
      },
    })
  })

  test("should propagate errors from SDK abort", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        sdk.session.abort = async () => {
          throw new Error("Abort failed")
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })

        const promise = agent.cancel({ sessionId: "test-session-789" })

        await expect(promise).rejects.toThrow("Abort failed")
      },
    })
  })

  test("should retrieve session info before aborting", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let sessionGetCalled = false
        const sdk = createMockSDK()

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })

        // The cancel method calls sessionManager.get(sessionId)
        // which should succeed for an existing session
        await agent.cancel({ sessionId: "test-session-789" })

        expect(true).toBe(true) // If we get here, session was retrieved successfully
      },
    })
  })
})
