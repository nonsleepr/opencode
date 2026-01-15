import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("ACP Agent - authenticate()", () => {
  test("should throw 'Authentication not implemented' error", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const sdk = {}
        const mockConnection = {
          sessionUpdate: async () => {},
          requestPermission: async () => ({ selectedPermissionOptionId: "once" }),
        }

        const acpInit = await ACP.init({ sdk })
        const agent = acpInit.create(mockConnection, { sdk })

        // Call authenticate with any params
        const promise = agent.authenticate({
          method: "token",
          token: "test-token",
        } as any)

        // Expect it to throw
        expect(promise).rejects.toThrow("Authentication not implemented")
      },
    })
  })
})
