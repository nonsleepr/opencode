import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { RequestError } from "@agentclientprotocol/sdk"
import type { ListSessionsRequest, SessionInfo } from "@agentclientprotocol/sdk"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Session } from "../../src/session"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP session/list", () => {
  let agent: ACP.Agent
  let sdk: any
  let mockConnection: any
  let createdSessionIds: string[] = []
  let mockSessionData: any[] = []

  beforeAll(async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Create some test sessions
        const session1 = await Session.create({ title: "Test Session 1" })
        const session2 = await Session.create({ title: "Test Session 2" })
        const session3 = await Session.create({ title: "Test Session 3" })

        createdSessionIds = [session1.id, session2.id, session3.id]

        // Prepare mock session data based on created sessions
        mockSessionData = [
          {
            id: session1.id,
            directory: projectRoot,
            title: "Test Session 1",
            slug: "test-session-1",
            version: "1",
            time: {
              created: Math.floor(Date.now() / 1000) - 1000,
              updated: Math.floor(Date.now() / 1000),
            },
            summary: {
              additions: 10,
              deletions: 5,
              files: 3,
            },
          },
          {
            id: session2.id,
            directory: projectRoot,
            title: "Test Session 2",
            slug: "test-session-2",
            version: "1",
            time: {
              created: Math.floor(Date.now() / 1000) - 2000,
              updated: Math.floor(Date.now() / 1000) - 500,
            },
            summary: {
              additions: 20,
              deletions: 10,
              files: 5,
            },
          },
          {
            id: session3.id,
            directory: projectRoot,
            title: "Test Session 3",
            slug: "test-session-3",
            version: "1",
            time: {
              created: Math.floor(Date.now() / 1000) - 3000,
              updated: Math.floor(Date.now() / 1000) - 1000,
            },
            summary: {
              additions: 15,
              deletions: 8,
              files: 4,
            },
          },
        ]

        // Create mock SDK with session.list method
        sdk = {
          session: {
            list: async (params: any) => {
              // Filter by directory if provided
              let filtered = mockSessionData
              if (params.directory) {
                filtered = mockSessionData.filter((s) => s.directory === params.directory)
              }

              // Handle pagination
              const start = params.start ?? 0
              const limit = params.limit ?? 50
              const paginated = filtered.slice(start, start + limit)

              return {
                data: paginated,
              }
            },
          },
        }

        // Create mock connection
        mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        // Create agent instance
        const acpInit = await ACP.init({ sdk })
        agent = acpInit.create(mockConnection, { sdk })
      },
    })
  })

  afterAll(async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Clean up created sessions
        for (const sessionId of createdSessionIds) {
          try {
            await Session.remove(sessionId)
          } catch (err) {
            // Ignore errors during cleanup
          }
        }
      },
    })
  })

  test("should list sessions without parameters", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {}
        const response = await agent.unstable_listSessions(params)

        expect(response).toBeDefined()
        expect(response.sessions).toBeDefined()
        expect(Array.isArray(response.sessions)).toBe(true)
        expect(response.sessions.length).toBeGreaterThanOrEqual(3)
      },
    })
  })

  test("should return session info with required fields", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {}
        const response = await agent.unstable_listSessions(params)

        expect(response.sessions.length).toBeGreaterThan(0)

        const session = response.sessions[0]
        expect(session.sessionId).toBeDefined()
        expect(typeof session.sessionId).toBe("string")
        expect(session.cwd).toBeDefined()
        expect(typeof session.cwd).toBe("string")
        expect(session.cwd).toMatch(/^\//) // Should be absolute path
      },
    })
  })

  test("should include optional metadata fields", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {}
        const response = await agent.unstable_listSessions(params)

        const session = response.sessions[0]

        // title is optional
        if (session.title) {
          expect(typeof session.title).toBe("string")
        }

        // updatedAt is optional but should be ISO 8601 if present
        if (session.updatedAt) {
          expect(typeof session.updatedAt).toBe("string")
          expect(() => new Date(session.updatedAt!)).not.toThrow()
          expect(session.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        }

        // _meta should contain additional metadata
        if (session._meta) {
          expect(typeof session._meta).toBe("object")
        }
      },
    })
  })

  test("should filter sessions by cwd", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {
          cwd: projectRoot,
        }
        const response = await agent.unstable_listSessions(params)

        expect(response.sessions).toBeDefined()
        expect(Array.isArray(response.sessions)).toBe(true)

        // All returned sessions should match the cwd filter
        for (const session of response.sessions) {
          expect(session.cwd).toBe(projectRoot)
        }
      },
    })
  })

  test("should return empty array for non-existent directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {
          cwd: "/nonexistent/directory/that/does/not/exist",
        }
        const response = await agent.unstable_listSessions(params)

        expect(response.sessions).toBeDefined()
        expect(Array.isArray(response.sessions)).toBe(true)
        expect(response.sessions.length).toBe(0)
      },
    })
  })

  test("should handle cursor-based pagination", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // First page
        const params: ListSessionsRequest = {}
        const response = await agent.unstable_listSessions(params)

        expect(response.sessions).toBeDefined()

        // If we got a nextCursor, test it
        if (response.nextCursor) {
          const nextParams: ListSessionsRequest = {
            cursor: response.nextCursor,
          }
          const nextResponse = await agent.unstable_listSessions(nextParams)

          expect(nextResponse.sessions).toBeDefined()
          expect(Array.isArray(nextResponse.sessions)).toBe(true)

          // Sessions in second page should be different from first page
          const firstPageIds = new Set(response.sessions.map((s) => s.sessionId))
          const secondPageIds = nextResponse.sessions.map((s) => s.sessionId)

          for (const id of secondPageIds) {
            expect(firstPageIds.has(id)).toBe(false)
          }
        }
      },
    })
  })

  test("should generate valid cursor format", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {}
        const response = await agent.unstable_listSessions(params)

        if (response.nextCursor) {
          // Cursor should be base64-encoded JSON
          expect(typeof response.nextCursor).toBe("string")
          expect(response.nextCursor.length).toBeGreaterThan(0)

          // Should be valid base64
          const decoded = Buffer.from(response.nextCursor, "base64").toString("utf-8")
          expect(() => JSON.parse(decoded)).not.toThrow()

          const parsed = JSON.parse(decoded)
          expect(parsed.start).toBeDefined()
          expect(typeof parsed.start).toBe("number")
          expect(parsed.limit).toBeDefined()
          expect(typeof parsed.limit).toBe("number")
        }
      },
    })
  })

  test("should throw error for invalid cursor", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {
          cursor: "invalid-cursor!!!",
        }

        try {
          await agent.unstable_listSessions(params)
          expect(true).toBe(false) // Should not reach here
        } catch (error) {
          expect(error).toBeInstanceOf(RequestError)
          const reqError = error as RequestError
          expect(reqError.code).toBe(-32602) // Invalid params
        }
      },
    })
  })

  test("should throw error for malformed base64 cursor", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {
          cursor: Buffer.from("not valid json").toString("base64"),
        }

        try {
          await agent.unstable_listSessions(params)
          expect(true).toBe(false) // Should not reach here
        } catch (error) {
          expect(error).toBeInstanceOf(RequestError)
          const reqError = error as RequestError
          expect(reqError.code).toBe(-32602) // Invalid params
        }
      },
    })
  })

  test("should include _meta with additional information", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {}
        const response = await agent.unstable_listSessions(params)

        expect(response.sessions.length).toBeGreaterThan(0)

        const session = response.sessions[0]
        if (session._meta) {
          // Check for expected metadata fields
          const meta = session._meta as any

          if (meta.createdAt) {
            expect(typeof meta.createdAt).toBe("string")
            expect(() => new Date(meta.createdAt)).not.toThrow()
          }

          if (meta.slug) {
            expect(typeof meta.slug).toBe("string")
          }

          if (meta.version) {
            expect(typeof meta.version).toBe("string")
          }

          if (meta.summary) {
            expect(typeof meta.summary).toBe("object")
            expect(typeof meta.summary.additions).toBe("number")
            expect(typeof meta.summary.deletions).toBe("number")
            expect(typeof meta.summary.files).toBe("number")
          }
        }
      },
    })
  })

  test("should respect page size limit (50 default)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {}
        const response = await agent.unstable_listSessions(params)

        // Should not return more than 50 sessions on first page
        expect(response.sessions.length).toBeLessThanOrEqual(50)
      },
    })
  })

  test("should handle empty sessions list", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Use a directory that definitely has no sessions
        const params: ListSessionsRequest = {
          cwd: "/tmp/definitely-no-sessions-here-" + Date.now(),
        }
        const response = await agent.unstable_listSessions(params)

        expect(response.sessions).toBeDefined()
        expect(Array.isArray(response.sessions)).toBe(true)
        expect(response.sessions.length).toBe(0)
        expect(response.nextCursor).toBeUndefined()
      },
    })
  })

  test("should return sessions in consistent order", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const params: ListSessionsRequest = {}

        // Call twice with same parameters
        const response1 = await agent.unstable_listSessions(params)
        const response2 = await agent.unstable_listSessions(params)

        // Should return same sessions in same order
        expect(response1.sessions.length).toBe(response2.sessions.length)

        for (let i = 0; i < response1.sessions.length; i++) {
          expect(response1.sessions[i].sessionId).toBe(response2.sessions[i].sessionId)
        }
      },
    })
  })
})
