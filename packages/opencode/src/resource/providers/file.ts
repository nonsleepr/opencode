import type { Resource, ResourceProvider, ResourceContent } from "../types"
import { File } from "../../file"
import { Instance } from "../../project/instance"
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"
import { Log } from "../../util/log"

const log = Log.create({ service: "file-resource-provider" })

export class FileResourceProvider implements ResourceProvider {
  name = "file"
  schemes = ["file"]

  async search(query: string, limit: number): Promise<Resource[]> {
    const paths = await File.search({
      query,
      limit,
      dirs: true,
    })

    return paths.map((filePath) => {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(Instance.directory, filePath)
      const uri = pathToFileURL(absolutePath).toString()

      return {
        uri,
        name: filePath,
        mimeType: "text/plain",
        metadata: {
          // Files have no prefix
        },
      }
    })
  }

  async read(uri: string): Promise<ResourceContent> {
    const filepath = fileURLToPath(uri)
    log.info("reading file", { uri, filepath })

    const file = Bun.file(filepath)
    const stat = await file.stat()

    if (stat.isDirectory()) {
      return {
        uri,
        mimeType: "application/x-directory",
        text: await this.readDirectory(filepath),
      }
    }

    const mimeType = file.type || "text/plain"
    const isImage = mimeType.startsWith("image/") && mimeType !== "image/svg+xml"
    const isPdf = mimeType === "application/pdf"

    if (isImage || isPdf) {
      const bytes = await file.bytes()
      return {
        uri,
        mimeType,
        blob: Buffer.from(bytes).toString("base64"),
      }
    }

    // All other files are treated as text/plain
    const text = await file.text()
    return {
      uri,
      mimeType: "text/plain",
      text,
    }
  }

  private async readDirectory(dirPath: string): Promise<string> {
    const fs = await import("fs")
    const items = fs.readdirSync(dirPath)
    return items.join("\n")
  }
}
