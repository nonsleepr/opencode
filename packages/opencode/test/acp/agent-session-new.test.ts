import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP Agent - newSession()", () => {
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

  test("should create a new session and return sessionId", async () => {
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

        const response = await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(response.sessionId).toBe("test-session-123")
        expect(response.models).toBeDefined()
        expect(response.modes).toBeDefined()
        expect(response._meta).toEqual({})
      },
    })
  })

  test("should return available models", async () => {
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

        const response = await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(response.models).toBeDefined()
        expect(response.models.currentModelId).toBeDefined()
        expect(response.models.availableModels).toBeDefined()
        expect(Array.isArray(response.models.availableModels)).toBe(true)
      },
    })
  })

  test("should return available modes", async () => {
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

        const response = await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(response.modes).toBeDefined()
        expect(response.modes.currentModeId).toBeDefined()
        expect(response.modes.availableModes).toBeDefined()
        expect(Array.isArray(response.modes.availableModes)).toBe(true)
      },
    })
  })

  test("should handle MCP servers", async () => {
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

        await agent.newSession({
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

  test("should call session.create with correct parameters", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParams: any
        const sdk = createMockSDK()
        sdk.session.create = async (params: any) => {
          capturedParams = params
          return {
            data: {
              id: "test-session-123",
              time: { created: new Date().toISOString() },
            },
          }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        expect(capturedParams.directory).toBe("/test/cwd")
        expect(capturedParams.title).toContain("ACP Session")
      },
    })
  })

  test("should handle custom working directory", async () => {
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

        const response = await agent.newSession({
          cwd: "/custom/path",
          mcpServers: [],
        })

        expect(response.sessionId).toBe("test-session-123")
      },
    })
  })

  test("should include default model information", async () => {
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

        const response = await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Models should include the opencode/big-pickle model
        const modelIds = response.models.availableModels.map((m: any) => m.modelId)
        expect(modelIds).toContain("opencode/big-pickle")
      },
    })
  })

  test("should handle errors gracefully", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        sdk.session.create = async () => {
          throw new Error("Network error")
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const promise = agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        await expect(promise).rejects.toThrow("Network error")
      },
    })
  })

  test("should handle local MCP servers", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedMcpConfig: any
        const sdk = createMockSDK()
        sdk.mcp.add = async (params: any) => {
          capturedMcpConfig = params.config
          return { data: {} }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [
            {
              name: "local-server",
              command: "node",
              args: ["server.js"],
              env: [{ name: "PORT", value: "3000" }],
            },
          ],
        })

        expect(capturedMcpConfig.type).toBe("local")
        expect(capturedMcpConfig.command).toEqual(["node", "server.js"])
        expect(capturedMcpConfig.environment).toEqual({ PORT: "3000" })
      },
    })
  })

  test("should handle remote MCP servers with headers", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedMcpConfig: any
        const sdk = createMockSDK()
        sdk.mcp.add = async (params: any) => {
          capturedMcpConfig = params.config
          return { data: {} }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [
            {
              name: "remote-server",
              type: "sse" as const,
              url: "http://localhost:3000",
              headers: [
                { name: "Authorization", value: "Bearer token" },
                { name: "X-Custom", value: "value" },
              ],
            },
          ],
        })

        expect(capturedMcpConfig.type).toBe("remote")
        expect(capturedMcpConfig.url).toBe("http://localhost:3000")
        expect(capturedMcpConfig.headers).toEqual({
          Authorization: "Bearer token",
          "X-Custom": "value",
        })
      },
    })
  })
})
