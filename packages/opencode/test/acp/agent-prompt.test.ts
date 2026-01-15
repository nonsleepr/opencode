import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP Agent - prompt()", () => {
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
      list: async () => ({ data: [] }),
      prompt: async () => ({ data: {} }),
      command: async () => ({ data: {} }),
      summarize: async () => ({ data: {} }),
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

  test("should handle simple text prompt", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let promptCalled = false
        const sdk = createMockSDK()
        sdk.session.prompt = async () => {
          promptCalled = true
          return { data: {} }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        // Create a session first
        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        const response = await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "text",
              text: "Hello, how are you?",
            },
          ],
        })

        expect(promptCalled).toBe(true)
        expect(response.stopReason).toBe("end_turn")
      },
    })
  })

  test("should handle image with data URI", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParts: any
        const sdk = createMockSDK()
        sdk.session.prompt = async (params: any) => {
          capturedParts = params.parts
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "image",
              data: "base64encodeddata",
              mimeType: "image/png",
            },
          ],
        })

        expect(capturedParts).toBeDefined()
        expect(capturedParts.length).toBe(1)
        expect(capturedParts[0].type).toBe("file")
        expect(capturedParts[0].url).toContain("data:image/png;base64,")
        expect(capturedParts[0].mime).toBe("image/png")
      },
    })
  })

  test("should handle image with HTTP URI", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParts: any
        const sdk = createMockSDK()
        sdk.session.prompt = async (params: any) => {
          capturedParts = params.parts
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "image",
              uri: "http://example.com/image.png",
              mimeType: "image/png",
            },
          ],
        })

        expect(capturedParts).toBeDefined()
        expect(capturedParts.length).toBe(1)
        expect(capturedParts[0].type).toBe("file")
        expect(capturedParts[0].url).toBe("http://example.com/image.png")
      },
    })
  })

  test("should handle resource_link with file:// URI", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParts: any
        const sdk = createMockSDK()
        sdk.session.prompt = async (params: any) => {
          capturedParts = params.parts
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "resource_link",
              uri: "file:///home/user/test.txt",
            },
          ],
        })

        expect(capturedParts).toBeDefined()
        expect(capturedParts.length).toBe(1)
        expect(capturedParts[0].type).toBe("file")
        expect(capturedParts[0].filename).toBe("test.txt")
      },
    })
  })

  test("should handle resource_link with zed:// URI", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParts: any
        const sdk = createMockSDK()
        sdk.session.prompt = async (params: any) => {
          capturedParts = params.parts
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "resource_link",
              uri: "zed://file?path=/home/user/code.ts",
            },
          ],
        })

        expect(capturedParts).toBeDefined()
        expect(capturedParts.length).toBe(1)
        expect(capturedParts[0].type).toBe("file")
        expect(capturedParts[0].url).toBe("file:///home/user/code.ts")
        expect(capturedParts[0].filename).toBe("code.ts")
      },
    })
  })

  test("should handle resource with text content", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParts: any
        const sdk = createMockSDK()
        sdk.session.prompt = async (params: any) => {
          capturedParts = params.parts
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "resource",
              resource: {
                text: "Resource text content",
              },
            },
          ],
        })

        expect(capturedParts).toBeDefined()
        expect(capturedParts.length).toBe(1)
        expect(capturedParts[0].type).toBe("text")
        expect(capturedParts[0].text).toBe("Resource text content")
      },
    })
  })

  test("should handle /compact command", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let summarizeCalled = false
        const sdk = createMockSDK()
        sdk.session.summarize = async () => {
          summarizeCalled = true
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
          mcpServers: [],
        })

        const response = await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "text",
              text: "/compact",
            },
          ],
        })

        expect(summarizeCalled).toBe(true)
        expect(response.stopReason).toBe("end_turn")
      },
    })
  })

  test("should handle custom command", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let commandCalled = false
        let capturedCommand: any
        const sdk = createMockSDK()
        sdk.command.list = async () => ({
          data: [
            {
              name: "custom",
              description: "Custom command",
            },
          ],
        })
        sdk.session.command = async (params: any) => {
          commandCalled = true
          capturedCommand = params
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
          mcpServers: [],
        })

        const response = await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "text",
              text: "/custom arg1 arg2",
            },
          ],
        })

        expect(commandCalled).toBe(true)
        expect(capturedCommand.command).toBe("custom")
        expect(capturedCommand.arguments).toBe("arg1 arg2")
        expect(response.stopReason).toBe("end_turn")
      },
    })
  })

  test("should handle unknown command gracefully", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        sdk.command.list = async () => ({
          data: [],
        })

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

        const response = await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "text",
              text: "/unknown command",
            },
          ],
        })

        expect(response.stopReason).toBe("end_turn")
      },
    })
  })

  test("should call SDK prompt with correct model", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedModel: any
        const sdk = createMockSDK()
        sdk.session.prompt = async (params: any) => {
          capturedModel = params.model
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "text",
              text: "Test prompt",
            },
          ],
        })

        expect(capturedModel).toBeDefined()
        expect(capturedModel.providerID).toBe("opencode")
        expect(capturedModel.modelID).toBe("big-pickle")
      },
    })
  })

  test("should call SDK prompt with correct agent", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedAgent: any
        const sdk = createMockSDK()
        sdk.session.prompt = async (params: any) => {
          capturedAgent = params.agent
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "text",
              text: "Test prompt",
            },
          ],
        })

        expect(capturedAgent).toBeDefined()
      },
    })
  })

  test("should handle multiple prompt parts", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParts: any
        const sdk = createMockSDK()
        sdk.session.prompt = async (params: any) => {
          capturedParts = params.parts
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "text",
              text: "First part",
            },
            {
              type: "text",
              text: "Second part",
            },
            {
              type: "resource_link",
              uri: "file:///test.txt",
            },
          ],
        })

        expect(capturedParts).toBeDefined()
        expect(capturedParts.length).toBe(3)
        expect(capturedParts[0].text).toBe("First part")
        expect(capturedParts[1].text).toBe("Second part")
        expect(capturedParts[2].type).toBe("file")
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

        const promise = agent.prompt({
          sessionId: "non-existent-session",
          prompt: [
            {
              type: "text",
              text: "Test",
            },
          ],
        })

        await expect(promise).rejects.toThrow()
      },
    })
  })

  test("should handle command with no arguments", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedCommand: any
        const sdk = createMockSDK()
        sdk.command.list = async () => ({
          data: [
            {
              name: "simple",
              description: "Simple command",
            },
          ],
        })
        sdk.session.command = async (params: any) => {
          capturedCommand = params
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "text",
              text: "/simple",
            },
          ],
        })

        expect(capturedCommand.command).toBe("simple")
        expect(capturedCommand.arguments).toBe("")
      },
    })
  })

  test("should handle invalid URI in resource_link", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParts: any
        const sdk = createMockSDK()
        sdk.session.prompt = async (params: any) => {
          capturedParts = params.parts
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
          mcpServers: [],
        })

        await agent.prompt({
          sessionId: "test-session-123",
          prompt: [
            {
              type: "resource_link",
              uri: "not-a-valid-uri",
            },
          ],
        })

        expect(capturedParts).toBeDefined()
        expect(capturedParts.length).toBe(1)
        // Invalid URIs should fall back to text
        expect(capturedParts[0].type).toBe("text")
        expect(capturedParts[0].text).toBe("not-a-valid-uri")
      },
    })
  })
})
