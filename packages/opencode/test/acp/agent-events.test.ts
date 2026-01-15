import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP Agent - Event Subscriptions", () => {
  const createBaseMockSDK = () => ({
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
      message: async () => ({
        data: {
          id: "test-message-1",
          sessionID: "test-session-123",
          info: { role: "assistant" as const },
          parts: [],
        },
      }),
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
        data: [],
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
        stream: (async function* () {})(),
      }),
    },
  })

  test("should handle permission.asked event with approval", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let permissionRequestReceived = false
        let permissionReplyCalled = false
        let replyValue: string | undefined

        const sdk = createBaseMockSDK()
        sdk.permission.reply = async (params: any) => {
          permissionReplyCalled = true
          replyValue = params.reply
          return { data: {} }
        }
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "permission.asked",
              properties: {
                id: "perm-123",
                sessionID: "test-session-123",
                permission: "read",
                metadata: { filepath: "/test/file.txt" },
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => {
            permissionRequestReceived = true
            return {
              outcome: {
                outcome: "selected" as const,
                optionId: "once",
              },
            }
          },
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(permissionRequestReceived).toBe(true)
        expect(permissionReplyCalled).toBe(true)
        expect(replyValue).toBe("once")
      },
    })
  })

  test("should handle permission.asked event with rejection", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let permissionReplyCalled = false
        let replyValue: string | undefined

        const sdk = createBaseMockSDK()
        sdk.permission.reply = async (params: any) => {
          permissionReplyCalled = true
          replyValue = params.reply
          return { data: {} }
        }
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "permission.asked",
              properties: {
                id: "perm-456",
                sessionID: "test-session-123",
                permission: "write",
                metadata: { filepath: "/test/file.txt" },
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({
            outcome: {
              outcome: "selected" as const,
              optionId: "reject",
            },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(permissionReplyCalled).toBe(true)
        expect(replyValue).toBe("reject")
      },
    })
  })

  test("should handle permission.asked event when requestPermission fails", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let permissionReplyCalled = false
        let replyValue: string | undefined

        const sdk = createBaseMockSDK()
        sdk.permission.reply = async (params: any) => {
          permissionReplyCalled = true
          replyValue = params.reply
          return { data: {} }
        }
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "permission.asked",
              properties: {
                id: "perm-789",
                sessionID: "test-session-123",
                permission: "read",
                metadata: {},
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => {
            throw new Error("Connection failed")
          },
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(permissionReplyCalled).toBe(true)
        expect(replyValue).toBe("reject")
      },
    })
  })

  test("should handle message.part.updated event with tool pending", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let toolCallReceived = false
        let toolCallStatus: string | undefined

        const sdk = createBaseMockSDK()
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "tool",
                  callID: "tool-call-123",
                  tool: "read",
                  sessionID: "test-session-123",
                  messageID: "msg-123",
                  state: {
                    status: "pending",
                  },
                },
                delta: null,
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "tool_call") {
              toolCallReceived = true
              toolCallStatus = params.update.status
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(toolCallReceived).toBe(true)
        expect(toolCallStatus).toBe("pending")
      },
    })
  })

  test("should handle message.part.updated event with tool running", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let toolCallReceived = false
        let toolCallStatus: string | undefined

        const sdk = createBaseMockSDK()
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "tool",
                  callID: "tool-call-456",
                  tool: "write",
                  sessionID: "test-session-123",
                  messageID: "msg-456",
                  state: {
                    status: "running",
                    input: { filepath: "/test/file.txt", content: "test content" },
                  },
                },
                delta: null,
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "tool_call_update") {
              toolCallReceived = true
              toolCallStatus = params.update.status
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(toolCallReceived).toBe(true)
        expect(toolCallStatus).toBe("in_progress")
      },
    })
  })

  test("should handle message.part.updated event with tool completed", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let toolCallReceived = false
        let toolCallStatus: string | undefined
        let toolContent: any

        const sdk = createBaseMockSDK()
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "tool",
                  callID: "tool-call-789",
                  tool: "read",
                  sessionID: "test-session-123",
                  messageID: "msg-789",
                  state: {
                    status: "completed",
                    title: "Read File",
                    input: { filepath: "/test/file.txt" },
                    output: "File contents here",
                    metadata: {},
                  },
                },
                delta: null,
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "tool_call_update") {
              toolCallReceived = true
              toolCallStatus = params.update.status
              toolContent = params.update.content
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(toolCallReceived).toBe(true)
        expect(toolCallStatus).toBe("completed")
        expect(toolContent).toBeDefined()
        expect(toolContent[0].type).toBe("content")
        expect(toolContent[0].content.text).toBe("File contents here")
      },
    })
  })

  test("should handle message.part.updated event with edit tool completed", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let diffReceived = false

        const sdk = createBaseMockSDK()
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "tool",
                  callID: "tool-call-edit",
                  tool: "edit",
                  sessionID: "test-session-123",
                  messageID: "msg-edit",
                  state: {
                    status: "completed",
                    title: "Edit File",
                    input: {
                      filePath: "/test/file.txt",
                      oldString: "old text",
                      newString: "new text",
                    },
                    output: "Edit completed",
                    metadata: {},
                  },
                },
                delta: null,
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "tool_call_update") {
              const content = params.update.content
              if (content && content.find((c: any) => c.type === "diff")) {
                diffReceived = true
              }
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(diffReceived).toBe(true)
      },
    })
  })

  test("should handle message.part.updated event with todowrite tool", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let planUpdateReceived = false

        const sdk = createBaseMockSDK()
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "tool",
                  callID: "tool-call-todo",
                  tool: "todowrite",
                  sessionID: "test-session-123",
                  messageID: "msg-todo",
                  state: {
                    status: "completed",
                    title: "Update Todo",
                    input: {},
                    output: JSON.stringify([
                      { id: "1", content: "Task 1", status: "pending", priority: "high" },
                      { id: "2", content: "Task 2", status: "in_progress", priority: "medium" },
                    ]),
                    metadata: {},
                  },
                },
                delta: null,
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "plan") {
              planUpdateReceived = true
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(planUpdateReceived).toBe(true)
      },
    })
  })

  test("should handle message.part.updated event with tool error", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let toolCallReceived = false
        let toolCallStatus: string | undefined

        const sdk = createBaseMockSDK()
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "tool",
                  callID: "tool-call-error",
                  tool: "read",
                  sessionID: "test-session-123",
                  messageID: "msg-error",
                  state: {
                    status: "error",
                    input: { filepath: "/nonexistent.txt" },
                    error: "File not found",
                  },
                },
                delta: null,
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "tool_call_update") {
              toolCallReceived = true
              toolCallStatus = params.update.status
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(toolCallReceived).toBe(true)
        expect(toolCallStatus).toBe("failed")
      },
    })
  })

  test("should handle message.part.updated event with text delta", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let textChunkReceived = false
        let receivedText: string | undefined

        const sdk = createBaseMockSDK()
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "text",
                  sessionID: "test-session-123",
                  messageID: "msg-text",
                  synthetic: false,
                },
                delta: "Hello, ",
              },
            }
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "text",
                  sessionID: "test-session-123",
                  messageID: "msg-text",
                  synthetic: false,
                },
                delta: "world!",
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "agent_message_chunk") {
              textChunkReceived = true
              receivedText = params.update.content.text
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(textChunkReceived).toBe(true)
        expect(receivedText).toBeDefined()
      },
    })
  })

  test("should handle message.part.updated event with reasoning delta", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let reasoningChunkReceived = false
        let receivedReasoning: string | undefined

        const sdk = createBaseMockSDK()
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "reasoning",
                  sessionID: "test-session-123",
                  messageID: "msg-reasoning",
                },
                delta: "Thinking about the problem...",
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "agent_thought_chunk") {
              reasoningChunkReceived = true
              receivedReasoning = params.update.content.text
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(reasoningChunkReceived).toBe(true)
        expect(receivedReasoning).toBe("Thinking about the problem...")
      },
    })
  })

  test("should ignore text delta when synthetic is true", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let textChunkReceived = false

        const sdk = createBaseMockSDK()
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "text",
                  sessionID: "test-session-123",
                  messageID: "msg-synthetic",
                  synthetic: true,
                },
                delta: "Synthetic text",
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "agent_message_chunk") {
              textChunkReceived = true
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(textChunkReceived).toBe(false)
      },
    })
  })

  test("should ignore message.part.updated when message role is not assistant", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let toolCallReceived = false

        const sdk = createBaseMockSDK()
        sdk.session.message = async () => ({
          data: {
            id: "test-message-1",
            sessionID: "test-session-123",
            info: { role: "user" as const }, // Not assistant
            parts: [],
          },
        })
        sdk.event.subscribe = async () => ({
          stream: (async function* () {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  type: "tool",
                  callID: "tool-call-999",
                  tool: "read",
                  sessionID: "test-session-123",
                  messageID: "msg-999",
                  state: {
                    status: "pending",
                  },
                },
                delta: null,
              },
            }
          })(),
        })

        const mockConnection = {
          sessionUpdate: async (params: any) => {
            if (params.update.sessionUpdate === "tool_call") {
              toolCallReceived = true
            }
          },
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "once" },
          }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.newSession({
          cwd: "/test/cwd",
          mcpServers: [],
        })

        // Give time for event handler to process
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(toolCallReceived).toBe(false)
      },
    })
  })
})
