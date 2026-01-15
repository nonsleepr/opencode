import { describe, expect, test, beforeEach } from "bun:test"
import { ACPSessionManager } from "../../src/acp/session"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { RequestError } from "@agentclientprotocol/sdk"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACPSessionManager", () => {
  let manager: ACPSessionManager
  let sdk: any

  beforeEach(() => {
    sdk = {
      session: {
        create: async () => ({
          data: {
            id: "test-session-123",
            time: { created: new Date().toISOString() },
          },
        }),
        get: async () => ({
          data: {
            id: "existing-session-456",
            time: { created: "2024-01-01T00:00:00Z" },
          },
        }),
      },
    }
  })

  describe("create()", () => {
    test("should create a new session with SDK", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const state = await manager.create("/test/cwd", [], {
            providerID: "opencode",
            modelID: "big-pickle",
          })

          expect(state.id).toBe("test-session-123")
          expect(state.cwd).toBe("/test/cwd")
          expect(state.mcpServers).toEqual([])
          expect(state.model?.providerID).toBe("opencode")
          expect(state.model?.modelID).toBe("big-pickle")
          expect(state.createdAt).toBeInstanceOf(Date)
        },
      })
    })

    test("should store session in internal map", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const state = await manager.create("/test/cwd", [], {
            providerID: "opencode",
            modelID: "big-pickle",
          })

          const retrieved = manager.get(state.id)
          expect(retrieved).toEqual(state)
        },
      })
    })

    test("should create session with MCP servers", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const mcpServers = [{ name: "test-server", url: "http://localhost:3000" }] as any

          const state = await manager.create("/test/cwd", mcpServers)

          expect(state.mcpServers).toEqual(mcpServers)
        },
      })
    })

    test("should create session without model", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const state = await manager.create("/test/cwd", [])

          expect(state.model).toBeUndefined()
        },
      })
    })

    test("should call SDK with correct parameters", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          let capturedParams: any

          sdk.session.create = async (params: any) => {
            capturedParams = params
            return {
              data: {
                id: "test-session-123",
                time: { created: new Date().toISOString() },
              },
            }
          }

          manager = new ACPSessionManager(sdk)
          await manager.create("/test/cwd", [])

          expect(capturedParams.directory).toBe("/test/cwd")
          expect(capturedParams.title).toContain("ACP Session")
        },
      })
    })
  })

  describe("load()", () => {
    test("should load existing session from SDK", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const state = await manager.load("existing-session-456", "/test/cwd", [], {
            providerID: "opencode",
            modelID: "big-pickle",
          })

          expect(state.id).toBe("existing-session-456")
          expect(state.cwd).toBe("/test/cwd")
          expect(state.createdAt).toEqual(new Date("2024-01-01T00:00:00Z"))
        },
      })
    })

    test("should store loaded session in internal map", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const state = await manager.load("existing-session-456", "/test/cwd", [])

          const retrieved = manager.get("existing-session-456")
          expect(retrieved).toEqual(state)
        },
      })
    })

    test("should load session with MCP servers", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const mcpServers = [{ name: "test-server", url: "http://localhost:3000" }] as any

          const state = await manager.load("existing-session-456", "/test/cwd", mcpServers)

          expect(state.mcpServers).toEqual(mcpServers)
        },
      })
    })

    test("should call SDK with correct parameters", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          let capturedParams: any

          sdk.session.get = async (params: any) => {
            capturedParams = params
            return {
              data: {
                id: "existing-session-456",
                time: { created: "2024-01-01T00:00:00Z" },
              },
            }
          }

          manager = new ACPSessionManager(sdk)
          await manager.load("existing-session-456", "/test/cwd", [])

          expect(capturedParams.sessionID).toBe("existing-session-456")
          expect(capturedParams.directory).toBe("/test/cwd")
        },
      })
    })
  })

  describe("get()", () => {
    test("should retrieve stored session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const created = await manager.create("/test/cwd", [])
          const retrieved = manager.get(created.id)

          expect(retrieved).toEqual(created)
        },
      })
    })

    test("should throw RequestError.invalidParams for non-existent session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          expect(() => manager.get("non-existent")).toThrow()
        },
      })
    })
  })

  describe("getModel()", () => {
    test("should return model for existing session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const model = { providerID: "opencode", modelID: "big-pickle" }
          const created = await manager.create("/test/cwd", [], model)

          const retrievedModel = manager.getModel(created.id)
          expect(retrievedModel).toEqual(model)
        },
      })
    })

    test("should return undefined for session without model", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const created = await manager.create("/test/cwd", [])

          const retrievedModel = manager.getModel(created.id)
          expect(retrievedModel).toBeUndefined()
        },
      })
    })

    test("should throw for non-existent session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          expect(() => manager.getModel("non-existent")).toThrow()
        },
      })
    })
  })

  describe("setModel()", () => {
    test("should update model for existing session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const created = await manager.create("/test/cwd", [])

          const newModel = { providerID: "anthropic", modelID: "claude-3" }
          const updated = manager.setModel(created.id, newModel)

          expect(updated.model).toEqual(newModel)
          expect(manager.getModel(created.id)).toEqual(newModel)
        },
      })
    })

    test("should persist model change in internal map", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const created = await manager.create("/test/cwd", [])
          const newModel = { providerID: "anthropic", modelID: "claude-3" }

          manager.setModel(created.id, newModel)

          const retrieved = manager.get(created.id)
          expect(retrieved.model).toEqual(newModel)
        },
      })
    })

    test("should throw for non-existent session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          expect(() => manager.setModel("non-existent", { providerID: "opencode", modelID: "big-pickle" })).toThrow()
        },
      })
    })
  })

  describe("setMode()", () => {
    test("should update mode for existing session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const created = await manager.create("/test/cwd", [])

          const updated = manager.setMode(created.id, "fast")

          expect(updated.modeId).toBe("fast")
        },
      })
    })

    test("should persist mode change in internal map", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const created = await manager.create("/test/cwd", [])

          manager.setMode(created.id, "fast")

          const retrieved = manager.get(created.id)
          expect(retrieved.modeId).toBe("fast")
        },
      })
    })

    test("should throw for non-existent session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          expect(() => manager.setMode("non-existent", "fast")).toThrow()
        },
      })
    })

    test("should allow multiple mode updates", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          manager = new ACPSessionManager(sdk)

          const created = await manager.create("/test/cwd", [])

          manager.setMode(created.id, "fast")
          manager.setMode(created.id, "accurate")

          const retrieved = manager.get(created.id)
          expect(retrieved.modeId).toBe("accurate")
        },
      })
    })
  })
})
