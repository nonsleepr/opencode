/**
 * URL resource provider plugin
 *
 * This plugin allows you to include web content in your prompts using @https://example.com syntax.
 * The plugin fetches web content and converts it to markdown.
 *
 * Features:
 * - Support for http:// and https:// URLs
 * - Automatic content fetching when URL is included
 * - Converts web content to markdown by default
 * - No autocomplete (URLs are typed directly)
 *
 * To use:
 * 1. Copy this file to .opencode/plugin/
 * 2. Type @https://example.com in your prompt
 * 3. The content will be fetched and included in your conversation
 *
 * Example:
 * @https://docs.opencode.ai/resources
 * Read the documentation above and help me understand resource providers
 */

import type { Plugin } from "@opencode-ai/plugin"

export const URLResourcePlugin: Plugin = async (ctx) => {
  return {
    "resource.provider": {
      name: "url",
      schemes: ["http", "https"],

      // No autocomplete for URLs - users type them directly
      async search(_query: string, _limit: number) {
        return []
      },

      // Fetch and return URL content
      async read(uri: string) {
        try {
          // Use native fetch to get the content
          const response = await fetch(uri, {
            headers: {
              "User-Agent": "OpenCode/1.0",
            },
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }

          const html = await response.text()

          // Simple HTML to text conversion
          // In production, you might want to use a proper HTML-to-markdown library
          const text = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()

          return {
            uri,
            mimeType: "text/plain",
            text: text.slice(0, 100000), // Limit to 100KB
          }
        } catch (error) {
          // If fetch fails, return error as content
          const message = error instanceof Error ? error.message : String(error)
          return {
            uri,
            mimeType: "text/plain",
            text: `Failed to fetch URL: ${message}`,
          }
        }
      },
    },
  }
}
