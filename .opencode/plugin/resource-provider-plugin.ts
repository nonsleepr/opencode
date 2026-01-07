/**
 * Example resource provider plugin
 *
 * This plugin demonstrates how to add custom @ references to OpenCode.
 * It adds a simple documentation resource provider.
 *
 * To use:
 * 1. Copy this file to .opencode/plugin/
 * 2. Type @react to see documentation suggestions
 * 3. Select a result to inject the documentation into your prompt
 */

import type { Plugin } from "@opencode-ai/plugin"

// Sample documentation index
const DOCS = {
  "react/hooks": {
    title: "React Hooks",
    content: `# React Hooks

Hooks are functions that let you "hook into" React state and lifecycle features from function components.

Common hooks:
- useState: Manage component state
- useEffect: Perform side effects
- useContext: Access context values
- useReducer: Complex state management
- useMemo: Memoize expensive computations
- useCallback: Memoize callback functions`,
  },
  "react/components": {
    title: "React Components",
    content: `# React Components

Components let you split the UI into independent, reusable pieces.

Types:
- Function Components: Simpler, use hooks for state
- Class Components: Legacy, use this.state and lifecycle methods`,
  },
  "typescript/types": {
    title: "TypeScript Types",
    content: `# TypeScript Types

TypeScript adds static type checking to JavaScript.

Basic types:
- string, number, boolean
- Array<T>, T[]
- Object types: { key: type }
- Union types: string | number
- Intersection types: A & B`,
  },
}

export const DocsResourcePlugin: Plugin = async (ctx) => {
  return {
    "resource.provider": {
      // Unique name for this provider
      name: "docs",

      // URI schemes this provider handles
      schemes: ["docs"],

      // Search for resources matching the query
      async search(query: string, limit: number) {
        const lowerQuery = query.toLowerCase()

        // Filter docs by query
        const matches = Object.entries(DOCS)
          .filter(([key, doc]) => key.includes(lowerQuery) || doc.title.toLowerCase().includes(lowerQuery))
          .slice(0, limit)

        // Return as resources
        return matches.map(([key, doc]) => ({
          uri: `docs://${key}`,
          name: doc.title,
          description: key,
          mimeType: "text/markdown",
          metadata: {
            // Subtitle shows in autocomplete: "React Hooks · [docs]"
            subtitle: "[docs]",
          },
        }))
      },

      // Read the content of a resource
      async read(uri: string) {
        // Extract doc key from URI
        const key = uri.replace("docs://", "")
        const doc = DOCS[key as keyof typeof DOCS]

        if (!doc) {
          throw new Error(`Documentation not found: ${key}`)
        }

        // Return content
        return {
          uri,
          mimeType: "text/markdown",
          text: doc.content,
        }
      },
    },
  }
}
