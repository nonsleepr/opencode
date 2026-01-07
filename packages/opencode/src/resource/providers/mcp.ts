import type { Resource, ResourceProvider, ResourceContent } from "../types"
import { MCP } from "../../mcp"
import { Log } from "../../util/log"
import { Instance } from "../../project/instance"

const log = Log.create({ service: "mcp-resource-provider" })

export class MCPResourceProvider implements ResourceProvider {
  name = "mcp"
  schemes: string[] = []

  private state = Instance.state(async () => {
    return {
      resourceMap: new Map<string, string>(),
      lastUpdate: 0,
    }
  })

  async search(query: string, limit: number): Promise<Resource[]> {
    try {
      await this.refreshResourceMap()
      const mcpResources = await MCP.resources()
      const lowerQuery = query.toLowerCase()

      const matches = Object.values(mcpResources)
        .filter((r) => {
          // Empty query means show all (for scheme-based searches like "file://")
          if (lowerQuery === "") return true

          // Search name, description, or URI
          return (
            r.name.toLowerCase().includes(lowerQuery) ||
            r.uri.toLowerCase().includes(lowerQuery) ||
            r.description?.toLowerCase().includes(lowerQuery)
          )
        })
        .slice(0, limit)

      return matches.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        metadata: {
          clientName: r.client,
          prefix: `[${r.client}]`,
        },
      }))
    } catch (error) {
      log.error("failed to search MCP resources", { error })
      return []
    }
  }

  async read(uri: string): Promise<ResourceContent> {
    const s = await this.state()
    let clientName = s.resourceMap.get(uri)

    if (!clientName) {
      log.info("MCP resource not in cache, refreshing", { uri })
      await this.refreshResourceMap()
      clientName = s.resourceMap.get(uri)
    }

    if (!clientName) {
      throw new Error(`No MCP server provides resource: ${uri}`)
    }

    log.info("reading MCP resource", { uri, clientName })
    const result = await MCP.readResource(clientName, uri)

    if (!result) {
      throw new Error(`MCP server ${clientName} could not read resource: ${uri}`)
    }

    return this.transformMCPContent(result, uri)
  }

  private async refreshResourceMap(): Promise<void> {
    const s = await this.state()

    try {
      const mcpResources = await MCP.resources()

      s.resourceMap.clear()
      const schemes = new Set<string>()

      for (const resource of Object.values(mcpResources)) {
        s.resourceMap.set(resource.uri, resource.client)

        try {
          const url = new URL(resource.uri)
          schemes.add(url.protocol.slice(0, -1))
        } catch {
          // Invalid URI, skip scheme extraction
        }
      }

      this.schemes = Array.from(schemes)
      s.lastUpdate = Date.now()

      log.debug("refreshed MCP resource map", {
        count: s.resourceMap.size,
        schemes: this.schemes,
      })
    } catch (error) {
      log.error("failed to refresh MCP resource map", { error })
    }
  }

  private transformMCPContent(result: Awaited<ReturnType<typeof MCP.readResource>>, uri: string): ResourceContent {
    if (!result) {
      throw new Error(`Empty result for resource: ${uri}`)
    }

    const contents = Array.isArray(result.contents) ? result.contents : [result.contents]

    const textParts = contents.filter((c) => "text" in c && c.text)
    const blobParts = contents.filter((c) => "blob" in c && c.blob)

    if (textParts.length > 0) {
      const text = textParts
        .map((c, i) => {
          const separator =
            textParts.length > 1 ? `\n--- Part ${i + 1} ${c.mimeType ? `(${c.mimeType})` : ""} ---\n` : ""
          return separator + c.text
        })
        .join("\n\n")

      return {
        uri,
        mimeType: textParts[0].mimeType || "text/plain",
        text,
      }
    }

    if (blobParts.length > 0) {
      if (blobParts.length > 1) {
        log.warn("MCP resource has multiple blobs, using first", { uri, count: blobParts.length })
      }

      return {
        uri,
        mimeType: blobParts[0].mimeType || "application/octet-stream",
        blob: blobParts[0].blob as string,
      }
    }

    throw new Error(`MCP resource has no readable content: ${uri}`)
  }

  async updateSchemes(): Promise<void> {
    await this.refreshResourceMap()
  }
}
