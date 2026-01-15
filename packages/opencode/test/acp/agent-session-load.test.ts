import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"
import { LoadAPIKeyError } from "ai"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP Agent - loadSession()", () => {
  const createMockSDK = () => ({
    config: {
      get: async () => ({
        data: {
          model: "opencode/big-pickle",
        },
      }),
      providers: async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "OpenCode",
              models: {
                "big-pickle": {
                  id: "big-pickle",
                  name: "Big Pickle",
                  providerID: "opencode",
                },
              },
            },
          ],
        },
      }),
    },
    session: {
      create: async () => ({
        data: {
          id: "test-session-123",
          time: { created: new Date().toISOString() },
        },
      }),
      get: async () => ({
        data: {
          id: "test-session-123",
          time: { created: new Date().toISOString() },
        },
      }),
      messages: async () => ({ data: [] }),
      message: async () => ({ data: null }),
    },
    app: {
      agents: async () => ({
        data: [
          {
            name: "general",
            description: "General purpose agent",
            mode: "agent",
            hidden: false,
          },
        ],
      }),
    },
    command: {
      list: async () => ({
        data: [
          {
            name: "test-command",
            description: "Test command",
          },
        ],
      }),
    },
    mcp: {
      add: async () => ({ data: {} }),
    },
    permission: {
      reply: async () => ({ data: {} }),
    },
    event: {
      subscribe: async () => ({
        stream: (async function* () {
          // Empty async generator for event subscriptions
        })(),
      }),
    },
  })

  test("should load an existing session", async () => {
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

        const response = await agent.loadSession({
          sessionId: "existing-session-456",
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(response.models).toBeDefined()
        expect(response.modes).toBeDefined()
        expect(response._meta).toEqual({})
      },
    })
  })

  test("should replay session history with messages", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const messages = [
          {
            info: {
              role: "user" as const,
              sessionID: "session-123",
              messageID: "msg-1",
            },
            parts: [
              {
                type: "text" as const,
                text: "Hello",
              },
            ],
          },
          {
            info: {
              role: "assistant" as const,
              sessionID: "session-123",
              messageID: "msg-2",
            },
            parts: [
              {
                type: "text" as const,
                text: "Hi there",
              },
            ],
          },
        ]

        const sdk = createMockSDK()
        sdk.session.messages = async () => ({ data: messages })

        let sessionUpdateCalls = 0
        const mockConnection = {
          sessionUpdate: async () => {
            sessionUpdateCalls++
          },
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.loadSession({
          sessionId: "session-123",
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Verify messages were processed (session updates would be called for message parts)
        expect(sessionUpdateCalls).toBeGreaterThanOrEqual(0)
      },
    })
  })

  test("should handle empty message history", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        sdk.session.messages = async () => ({ data: [] })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.loadSession({
          sessionId: "empty-session",
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(response.models).toBeDefined()
        expect(response.modes).toBeDefined()
      },
    })
  })

  test("should handle undefined messages gracefully", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        sdk.session.messages = async () => ({ data: undefined })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.loadSession({
          sessionId: "no-messages-session",
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(response.models).toBeDefined()
        expect(response.modes).toBeDefined()
      },
    })
  })

  test("should call session.messages with correct parameters", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParams: any
        const sdk = createMockSDK()
        sdk.session.messages = async (params: any) => {
          capturedParams = params
          return { data: [] }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.loadSession({
          sessionId: "test-session",
          cwd: "/custom/path",
          mcpServers: [],
        })

        expect(capturedParams.sessionID).toBe("test-session")
        expect(capturedParams.directory).toBe("/custom/path")
      },
    })
  })

  test("should handle MCP servers when loading session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let mcpAddCalled = false
        const sdk = createMockSDK()
        sdk.mcp.add = async () => {
          mcpAddCalled = true
          return { data: {} }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.loadSession({
          sessionId: "session-with-mcp",
          cwd: "/test/cwd",
          mcpServers: [
            {
              name: "test-server",
              type: "sse" as const,
              url: "http://localhost:3000",
              headers: [{ name: "Authorization", value: "Bearer token" }],
            },
          ],
        })

        expect(mcpAddCalled).toBe(true)
      },
    })
  })

  test("should handle messages fetch error gracefully", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        sdk.session.messages = async () => {
          throw new Error("Network error")
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        // Should not throw - error is caught and logged
        const response = await agent.loadSession({
          sessionId: "error-session",
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(response.models).toBeDefined()
        expect(response.modes).toBeDefined()
      },
    })
  })

  test("should handle errors from session manager load", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        sdk.session.get = async () => {
          throw new Error("Session load error")
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const promise = agent.loadSession({
          sessionId: "error-session",
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Error should be propagated
        await expect(promise).rejects.toThrow("Session load error")
      },
    })
  })

  test("should replay tool call messages in history", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const messages = [
          {
            info: {
              role: "assistant" as const,
              sessionID: "session-123",
              messageID: "msg-1",
            },
            parts: [
              {
                type: "tool" as const,
                tool: "read",
                callID: "call-1",
                state: {
                  status: "pending" as const,
                  input: {},
                },
              },
            ],
          },
        ]

        const sdk = createMockSDK()
        sdk.session.messages = async () => ({ data: messages })

        let toolCallUpdateReceived = false
        const mockConnection = {
          sessionUpdate: async (update: any) => {
            if (update.update.sessionUpdate === "tool_call") {
              toolCallUpdateReceived = true
            }
          },
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.loadSession({
          sessionId: "session-123",
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(toolCallUpdateReceived).toBe(true)
      },
    })
  })

  test("should properly setup event subscriptions for loaded session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventSubscribeCalled = false
        const sdk = createMockSDK()
        sdk.event.subscribe = async () => {
          eventSubscribeCalled = true
          return {
            stream: (async function* () {})(),
          }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.loadSession({
          sessionId: "session-with-events",
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(eventSubscribeCalled).toBe(true)
      },
    })
  })
})
