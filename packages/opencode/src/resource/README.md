# Resource System

The resource system provides an extensible abstraction for @ references in OpenCode. Files are just one type of resource - plugins can add custom resource types like sessions, documentation, database schemas, or anything else.

---

## Architecture

The resource system consists of three main components that work together to provide extensible @ references.

---

### Core components

- **`types.ts`** - Core interfaces: `Resource`, `ResourceProvider`, `ResourceContent`
- **`registry.ts`** - Central registry that manages providers and routes requests
- **`providers/`** - Built-in resource providers (file, data, agent, mcp)

---

### Resource flow

When a user types `@query`, the following happens:

1. `ResourceRegistry.search(query)` is called
2. All providers run `search()` in parallel with a 2-second timeout
3. Results are scored by relevance and merged
4. Resources are displayed in autocomplete as `name · subtitle`
5. User selects a resource
6. `ResourceRegistry.read(uri)` is called with the selected URI
7. The appropriate provider's `read(uri)` method is invoked
8. Content is injected as synthetic parts into the prompt
9. LLM receives the resource content as context

---

## Built-in providers

OpenCode includes four built-in resource providers.

---

### FileResourceProvider

Handles file system resources.

- **Schemes:** `file://`
- **Subtitle:** None
- **Features:** Line ranges, directory listing, binary file support
- **Implementation:** Wraps existing `File.search()` logic

---

### DataResourceProvider

Handles inline data URIs.

- **Schemes:** `data:`
- **Subtitle:** None
- **Purpose:** Handle base64 encoded inline data
- **Note:** Not searchable - only supports direct reads

---

### AgentResourceProvider

Enables agent references in prompts.

- **Schemes:** `agent://`
- **Subtitle:** 🤖
- **Purpose:** Reference agents using @ syntax
- **Returns:** Synthetic instruction to invoke the task tool

---

### MCPResourceProvider

Exposes resources from MCP servers.

- **Schemes:** Dynamic (determined by MCP servers)
- **Subtitle:** `[client-name]` (e.g., `[git]`, `[github]`)
- **Purpose:** Expose MCP server resources through @ references
- **Features:** Dynamic scheme registration, per-client routing

---

## Plugin integration

Plugins can register custom resource providers using the `"resource.provider"` hook.

---

### Basic example

```typescript
export const MyPlugin: Plugin = async (ctx) => {
  return {
    "resource.provider": {
      name: "myresources",
      schemes: ["docs"],
      async search(query, limit) {
        return [
          {
            uri: "docs://example",
            name: "Example Doc",
            metadata: {
              subtitle: "[docs]", // Display: "Example Doc · [docs]"
            },
          },
        ]
      },
      async read(uri) {
        return {
          uri,
          mimeType: "text/plain",
          text: "Content here",
        }
      },
    },
  }
}
```

---

### Registration order

Providers are registered during `Plugin.init()`:

1. Built-in providers registered first (file, data, agent, mcp)
2. Plugin providers registered from hooks
3. All providers become available for search and read operations

---

### Search timeout

Search operations have a 2-second timeout to prevent blocking the user interface. If a provider takes longer than 2 seconds, it's skipped for that particular search.

---

## Backward compatibility

The resource system maintains full backward compatibility with existing functionality:

- The `/find/file` endpoint still returns string arrays for file paths
- `ReadTool` continues to accept the `filePath` parameter for local files
- `file://` URIs use existing permission checking and file reading logic
- `AgentPart` can coexist with `agent://` resource references

---

## Future enhancements

Planned improvements to the resource system:

- [x] TUI autocomplete UI update to show subtitle-based display
- [x] Web autocomplete UI update to show subtitle-based display
- [x] MCP server integration as resource providers
- [ ] Resource caching and invalidation
- [ ] Resource subscriptions (MCP compatibility)
- [ ] LSP-based symbol provider (via plugin)
