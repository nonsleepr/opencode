import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP agent.initialize", () => {
  let agent: ACP.Agent
  let mockConnection: any
  let sdk: any

  test("should return protocol version 1", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        sdk = {}
        mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.initialize({
          protocolVersion: 1,
        })

        expect(response.protocolVersion).toBe(1)
      },
    })
  })

  test("should advertise all agent capabilities correctly", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        sdk = {}
        mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.initialize({
          protocolVersion: 1,
        })

        expect(response.agentCapabilities).toBeDefined()
        expect(response.agentCapabilities.loadSession).toBe(true)
        expect(response.agentCapabilities.sessionCapabilities).toBeDefined()
        expect(response.agentCapabilities.sessionCapabilities?.list).toEqual({})
        expect(response.agentCapabilities.mcpCapabilities).toBeDefined()
        expect(response.agentCapabilities.mcpCapabilities?.http).toBe(true)
        expect(response.agentCapabilities.mcpCapabilities?.sse).toBe(true)
        expect(response.agentCapabilities.promptCapabilities).toBeDefined()
        expect(response.agentCapabilities.promptCapabilities?.embeddedContext).toBe(true)
        expect(response.agentCapabilities.promptCapabilities?.image).toBe(true)
      },
    })
  })

  test("should return auth method with correct structure", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        sdk = {}
        mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.initialize({
          protocolVersion: 1,
        })

        expect(response.authMethods).toBeDefined()
        expect(response.authMethods.length).toBe(1)
        expect(response.authMethods[0].id).toBe("opencode-login")
        expect(response.authMethods[0].name).toBe("Login with opencode")
        expect(response.authMethods[0].description).toBe("Run `opencode auth login` in the terminal")
      },
    })
  })

  test("should include terminal-auth metadata when client supports it", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        sdk = {}
        mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            _meta: {
              "terminal-auth": true,
            },
          },
        })

        expect(response.authMethods[0]._meta).toBeDefined()
        expect(response.authMethods[0]._meta?.["terminal-auth"]).toBeDefined()
        const terminalAuth = response.authMethods[0]._meta?.["terminal-auth"] as any
        expect(terminalAuth.command).toBe("opencode")
        expect(terminalAuth.args).toEqual(["auth", "login"])
        expect(terminalAuth.label).toBe("OpenCode Login")
      },
    })
  })

  test("should not include terminal-auth metadata when client does not support it", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        sdk = {}
        mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.initialize({
          protocolVersion: 1,
        })

        expect(response.authMethods[0]._meta).toBeUndefined()
      },
    })
  })

  test("should include agent info with name and version", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        sdk = {}
        mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        agent = acpInit.create(mockConnection, { sdk })

        const response = await agent.initialize({
          protocolVersion: 1,
        })

        expect(response.agentInfo).toBeDefined()
        expect(response.agentInfo.name).toBe("OpenCode")
        expect(response.agentInfo.version).toBeDefined()
        expect(typeof response.agentInfo.version).toBe("string")
      },
    })
  })
})
