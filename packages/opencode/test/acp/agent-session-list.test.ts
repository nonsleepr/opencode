import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP Agent - unstable_listSessions()", () => {
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

  test("should list sessions with no cursor", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessions = [
          {
            id: "session-1",
            directory: "/test/cwd",
            title: "Test Session 1",
            slug: "test-session-1",
            version: 1,
            time: {
              created: Math.floor(Date.now() / 1000),
              updated: Math.floor(Date.now() / 1000),
            },
          },
          {
            id: "session-2",
            directory: "/test/cwd",
            title: "Test Session 2",
            slug: "test-session-2",
            version: 1,
            time: {
              created: Math.floor(Date.now() / 1000),
              updated: Math.floor(Date.now() / 1000),
            },
          },
        ]

        const sdk = createMockSDK()
        sdk.session.list = async () => ({ data: sessions })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.unstable_listSessions({
          cwd: "/test/cwd",
        })

        expect(response.sessions).toBeDefined()
        expect(response.sessions.length).toBe(2)
        expect(response.sessions[0].sessionId).toBe("session-1")
        expect(response.sessions[1].sessionId).toBe("session-2")
      },
    })
  })

  test("should return empty array when no sessions exist", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        sdk.session.list = async () => ({ data: [] })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.unstable_listSessions({
          cwd: "/test/cwd",
        })

        expect(response.sessions).toBeDefined()
        expect(response.sessions.length).toBe(0)
        expect(response.nextCursor).toBeUndefined()
      },
    })
  })

  test("should handle pagination with cursor", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParams: any
        const sdk = createMockSDK()
        sdk.session.list = async (params: any) => {
          capturedParams = params
          return { data: [] }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        // Create a cursor: base64 encode JSON with start and limit
        const cursorData = { start: 10, limit: 20 }
        const cursor = Buffer.from(JSON.stringify(cursorData)).toString("base64")

        await agent.unstable_listSessions({
          cwd: "/test/cwd",
          cursor,
        })

        expect(capturedParams.start).toBe(10)
        expect(capturedParams.limit).toBe(20)
      },
    })
  })

  test("should generate nextCursor when full page is returned", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Create exactly 50 sessions (default page size)
        const sessions = Array.from({ length: 50 }, (_, i) => ({
          id: `session-${i}`,
          directory: "/test/cwd",
          title: `Session ${i}`,
          slug: `session-${i}`,
          version: 1,
          time: {
            created: Math.floor(Date.now() / 1000),
            updated: Math.floor(Date.now() / 1000),
          },
        }))

        const sdk = createMockSDK()
        sdk.session.list = async () => ({ data: sessions })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.unstable_listSessions({
          cwd: "/test/cwd",
        })

        expect(response.nextCursor).toBeDefined()

        // Decode the cursor to verify it's correct
        const decoded = Buffer.from(response.nextCursor!, "base64").toString("utf-8")
        const parsed = JSON.parse(decoded)
        expect(parsed.start).toBe(50)
        expect(parsed.limit).toBe(50)
      },
    })
  })

  test("should not generate nextCursor when partial page is returned", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Create less than page size (50)
        const sessions = Array.from({ length: 25 }, (_, i) => ({
          id: `session-${i}`,
          directory: "/test/cwd",
          title: `Session ${i}`,
          slug: `session-${i}`,
          version: 1,
          time: {
            created: Math.floor(Date.now() / 1000),
            updated: Math.floor(Date.now() / 1000),
          },
        }))

        const sdk = createMockSDK()
        sdk.session.list = async () => ({ data: sessions })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.unstable_listSessions({
          cwd: "/test/cwd",
        })

        expect(response.nextCursor).toBeUndefined()
      },
    })
  })

  test("should map session fields correctly", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const now = Math.floor(Date.now() / 1000)
        const sessions = [
          {
            id: "session-123",
            directory: "/test/project",
            title: "My Test Session",
            slug: "my-test-session",
            version: 2,
            time: {
              created: now,
              updated: now + 100,
            },
            summary: {
              additions: 50,
              deletions: 25,
              files: ["file1.ts", "file2.ts"],
            },
          },
        ]

        const sdk = createMockSDK()
        sdk.session.list = async () => ({ data: sessions })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.unstable_listSessions({
          cwd: "/test/project",
        })

        const session = response.sessions[0]
        expect(session.sessionId).toBe("session-123")
        expect(session.cwd).toBe("/test/project")
        expect(session.title).toBe("My Test Session")
        expect(session.updatedAt).toBeDefined()
        expect(session._meta.slug).toBe("my-test-session")
        expect(session._meta.version).toBe(2)
        expect(session._meta.createdAt).toBeDefined()
        expect(session._meta.summary).toBeDefined()
        expect(session._meta.summary?.additions).toBe(50)
        expect(session._meta.summary?.deletions).toBe(25)
        expect(session._meta.summary?.files).toEqual(["file1.ts", "file2.ts"])
      },
    })
  })

  test("should handle empty title as undefined", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessions = [
          {
            id: "session-1",
            directory: "/test/cwd",
            title: "", // Empty title
            slug: "untitled-session",
            version: 1,
            time: {
              created: Math.floor(Date.now() / 1000),
            },
          },
        ]

        const sdk = createMockSDK()
        sdk.session.list = async () => ({ data: sessions })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.unstable_listSessions({
          cwd: "/test/cwd",
        })

        expect(response.sessions[0].title).toBeUndefined()
      },
    })
  })

  test("should throw error for invalid cursor", async () => {
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

        const promise = agent.unstable_listSessions({
          cwd: "/test/cwd",
          cursor: "invalid-base64-!!!",
        })

        await expect(promise).rejects.toThrow()
      },
    })
  })

  test("should handle SDK errors gracefully", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = createMockSDK()
        sdk.session.list = async () => {
          throw new Error("Network error")
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const promise = agent.unstable_listSessions({
          cwd: "/test/cwd",
        })

        await expect(promise).rejects.toThrow()
      },
    })
  })

  test("should handle missing optional fields", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sessions = [
          {
            id: "minimal-session",
            directory: "/test/cwd",
            slug: "minimal",
            version: 1,
            time: {
              created: Math.floor(Date.now() / 1000),
              // No updated time
            },
            // No title, no summary
          },
        ]

        const sdk = createMockSDK()
        sdk.session.list = async () => ({ data: sessions })

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.unstable_listSessions({
          cwd: "/test/cwd",
        })

        const session = response.sessions[0]
        expect(session.sessionId).toBe("minimal-session")
        expect(session.title).toBeUndefined()
        expect(session.updatedAt).toBeUndefined()
        expect(session._meta.summary).toBeUndefined()
      },
    })
  })

  test("should call SDK with correct parameters", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let capturedParams: any
        const sdk = createMockSDK()
        sdk.session.list = async (params: any) => {
          capturedParams = params
          return { data: [] }
        }

        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        await agent.unstable_listSessions({
          cwd: "/custom/path",
        })

        expect(capturedParams.directory).toBe("/custom/path")
        expect(capturedParams.limit).toBe(50) // Default page size
        expect(capturedParams.start).toBeUndefined()
      },
    })
  })
})
