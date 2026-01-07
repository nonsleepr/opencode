import type { Resource, ResourceProvider, ResourceContent } from "../types"

/**
 * Resource provider for data: URIs (base64 encoded content)
 * Does not support search (only direct reads)
 */
export class DataResourceProvider implements ResourceProvider {
  name = "data"
  schemes = ["data"]

  async search(_query: string, _limit: number): Promise<Resource[]> {
    // data: URIs are not searchable
    return []
  }

  async read(uri: string): Promise<ResourceContent> {
    // Parse data URI: data:[<mime>][;base64],<data>
    const match = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
    if (!match) {
      throw new Error(`Invalid data URI: ${uri}`)
    }

    const mimeType = match[1] ?? "text/plain"
    const isBase64 = match[2] === ";base64"
    const data = match[3]

    if (mimeType === "text/plain") {
      // Return as text
      const text = isBase64 ? Buffer.from(data, "base64").toString() : decodeURIComponent(data)
      return {
        uri,
        mimeType,
        text,
      }
    }

    // Return as blob
    return {
      uri,
      mimeType,
      blob: isBase64 ? data : Buffer.from(decodeURIComponent(data)).toString("base64"),
    }
  }
}
