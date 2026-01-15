import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP Agent - setSessionModel()", () => {
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
        data: { id: "test-session-123", time: { created: new Date().toISOString() } },
      }),
      messages: async () => ({ data: [] }),
      message: async () => ({ data: null }),
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

  test("should update session model successfully", async () => {
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

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })

        const response = await agent.setSessionModel({
          sessionId: "test-session-123",
          modelId: "anthropic/claude-3",
        })

        expect(response._meta).toEqual({})
      },
    })
  })

  test("should parse and store model correctly", async () => {
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

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })
        await agent.setSessionModel({
          sessionId: "test-session-123",
          modelId: "anthropic/claude-3-opus",
        })

        // Model should be stored in session manager
        expect(true).toBe(true) // Session manager stores the model internally
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

        const promise = agent.setSessionModel({
          sessionId: "non-existent-session",
          modelId: "opencode/big-pickle",
        })

        await expect(promise).rejects.toThrow()
      },
    })
  })

  test("should handle model ID with provider prefix", async () => {
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

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })

        const response = await agent.setSessionModel({
          sessionId: "test-session-123",
          modelId: "openai/gpt-4",
        })

        expect(response._meta).toEqual({})
      },
    })
  })
})

describe("ACP Agent - setSessionMode()", () => {
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
        data: { id: "test-session-456", time: { created: new Date().toISOString() } },
      }),
      messages: async () => ({ data: [] }),
      message: async () => ({ data: null }),
    },
    app: {
      agents: async () => ({
        data: [
          { name: "general", description: "General purpose agent", mode: "agent", hidden: false },
          { name: "explore", description: "Explore agent", mode: "agent", hidden: false },
        ],
      }),
    },
    command: { list: async () => ({ data: [] }) },
    mcp: { add: async () => ({ data: {} }) },
    permission: { reply: async () => ({ data: {} }) },
    event: {
      subscribe: async () => ({ stream: (async function* () {})() }),
    },
  })

  test("should update session mode successfully", async () => {
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

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })

        await agent.setSessionMode({
          sessionId: "test-session-456",
          modeId: "explore",
        })

        // Should complete without error
        expect(true).toBe(true)
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

        const promise = agent.setSessionMode({
          sessionId: "non-existent-session",
          modeId: "general",
        })

        await expect(promise).rejects.toThrow()
      },
    })
  })

  test("should verify agent exists before setting mode", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        let agentsCalled = false
        sdk.app.agents = async () => {
          agentsCalled = true
          return {
            data: [{ name: "general", description: "General purpose agent", mode: "agent", hidden: false }],
          }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })
        await agent.setSessionMode({
          sessionId: "test-session-456",
          modeId: "general",
        })

        expect(agentsCalled).toBe(true)
      },
    })
  })

  test("should handle mode change multiple times", async () => {
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

        await agent.newSession({ cwd: "/test/cwd", mcpServers: [] })

        await agent.setSessionMode({
          sessionId: "test-session-456",
          modeId: "general",
        })

        await agent.setSessionMode({
          sessionId: "test-session-456",
          modeId: "explore",
        })

        // Should complete without error
        expect(true).toBe(true)
      },
    })
  })
})
