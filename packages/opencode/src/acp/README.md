# ACP (Agent Client Protocol) Implementation

This directory contains a clean, protocol-compliant implementation of the [Agent Client Protocol](https://agentclientprotocol.com/) for opencode.

## Architecture

The implementation follows a clean separation of concerns:

### Core Components

- **`agent.ts`** - Implements the `Agent` interface from `@agentclientprotocol/sdk`
  - Handles initialization and capability negotiation
  - Manages session lifecycle (`session/new`, `session/load`, `session/list`)
  - Processes prompts and returns responses
  - Properly implements ACP protocol v1

- **`client.ts`** - Implements the `Client` interface for client-side capabilities
  - File operations (`readTextFile`, `writeTextFile`)
  - Permission requests (auto-approves for now)
  - Terminal support (stub implementation)

- **`session.ts`** - Session state management
  - Creates and tracks ACP sessions
  - Maps ACP sessions to internal opencode sessions
  - Maintains working directory context
  - Handles MCP server configurations

- **`server.ts`** - ACP server startup and lifecycle
  - Sets up JSON-RPC over stdio using the official library
  - Manages graceful shutdown on SIGTERM/SIGINT
  - Provides Instance context for the agent

- **`types.ts`** - Type definitions for internal use

## Usage

### Command Line

```bash
# Start the ACP server in the current directory
opencode acp

# Start in a specific directory
opencode acp --cwd /path/to/project
```

### Programmatic

```typescript
import { ACPServer } from "./acp/server"

await ACPServer.start()
```

### Integration with Zed

Add to your Zed configuration (`~/.config/zed/settings.json`):

```json
{
  "agent_servers": {
    "OpenCode": {
      "command": "opencode",
      "args": ["acp"]
    }
  }
}
```

## Protocol Compliance

This implementation follows the ACP specification v1:

✅ **Initialization**

- Proper `initialize` request/response with protocol version negotiation
- Capability advertisement (`agentCapabilities`)
- Authentication support (stub)

✅ **Session Management**

- `session/new` - Create new conversation sessions
- `session/load` - Resume existing sessions with history replay
- `session/list` - List existing sessions with metadata (unstable, Draft RFD)
- `session/setMode` - Switch between agent modes
- Working directory context (`cwd`)
- MCP server configuration support

✅ **Prompting**

- `session/prompt` - Process user messages
- Content block handling (text, resources)
- Response with stop reasons

✅ **Streaming**

- Real-time `session/update` notifications
- Progressive text streaming (`agent_message_chunk`)
- Reasoning/thought streaming (`agent_thought_chunk`)
- Tool execution progress (`tool_call`, `tool_call_update`)
- Plan updates from TodoWrite tool

✅ **Client Capabilities**

- File read/write operations
- Permission requests
- Terminal support (stub for future)

## Session Management Features

### Listing Sessions (Unstable)

The `session/list` method allows clients to enumerate existing sessions with metadata. This feature is marked as **unstable** because it's currently in **Draft** status in the ACP RFD (Request for Dialog) process and has not yet been finalized. The API may change based on community feedback and real-world usage before reaching stable status.

**Request Example:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/list",
  "params": {
    "cwd": "/path/to/project"
  }
}
```

**Response Example:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "sessions": [
      {
        "sessionId": "sess_abc123",
        "cwd": "/path/to/project",
        "title": "Fix authentication bug",
        "updatedAt": "2026-01-14T10:30:00Z",
        "_meta": {
          "createdAt": "2026-01-14T09:00:00Z",
          "slug": "fix-auth",
          "version": "1.0.0"
        }
      }
    ],
    "nextCursor": "eyJzdGFydCI6NTAsImxpbWl0Ijo1MH0="
  }
}
```

**Features:**

- **Directory Filtering** - Filter by working directory with `cwd` parameter
- **Cursor-based Pagination** - Navigate large result sets via `cursor` and `nextCursor`
- **Default Page Size** - 50 sessions per page
- **Rich Metadata** - Includes session metadata in `_meta` field:
  - `createdAt` - ISO 8601 timestamp of session creation
  - `updatedAt` - ISO 8601 timestamp of last update
  - `slug` - URL-friendly session identifier
  - `version` - Session version string
  - `summary` - File change statistics (additions, deletions, files affected)
- **Error Handling** - Validates cursor format and returns proper JSON-RPC errors

**See:** [Session List RFD](https://agentclientprotocol.com/rfds/session-list)

**Implementation Details:**

The `unstable_listSessions()` method in `agent.ts`:

1. Parses and validates the cursor for pagination
2. Calls the backend SDK's `session.list()` API
3. Maps backend session data to ACP `SessionInfo` format
4. Converts Unix timestamps to ISO 8601 strings
5. Generates a new cursor if more results are available
6. Returns proper JSON-RPC errors for invalid inputs

Tests are available in `test/acp/session-list.test.ts` with full coverage.

## Current Limitations

### Not Yet Implemented

1. **Authentication** - No actual auth implementation (stub only)
2. **Terminal Support** - Placeholder only, no command execution

### Experimental Features

1. **Session Listing** - `unstable_listSessions` is currently a **Draft RFD** in the ACP specification and may change based on community feedback before reaching stable status. The API is subject to breaking changes until the RFD is completed and accepted. Requires `@agentclientprotocol/sdk` v0.13.0 or higher.
   - **RFD Status**: Draft (not yet finalized)
   - **Why unstable**: API may change based on real-world usage and feedback
   - **When it will stabilize**: After the RFD process completes and community consensus is reached

### Future Enhancements

- **Enhanced Authentication**: Implement actual authentication flow
- **Terminal Integration**: Full terminal support via opencode's bash tool
- **Enhanced Permissions**: More sophisticated permission handling with user prompts

## Testing

```bash
# Run all ACP tests
bun test test/acp/

# Run session list tests specifically
bun test test/acp/session-list.test.ts

# Test manually with stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' | opencode acp
```

The test suite includes comprehensive coverage for:

- Session listing with and without parameters
- Pagination with cursor support
- Directory filtering
- Error handling for invalid cursors
- Metadata validation
- Edge cases (empty results, consistent ordering)

## Design Decisions

### Why the Official Library?

We use `@agentclientprotocol/sdk` instead of implementing JSON-RPC ourselves because:

- Ensures protocol compliance
- Handles edge cases and future protocol versions
- Reduces maintenance burden
- Works with other ACP clients automatically

### Clean Architecture

Each component has a single responsibility:

- **Agent** = Protocol interface
- **Client** = Client-side operations
- **Session** = State management
- **Server** = Lifecycle and I/O

This makes the codebase maintainable and testable.

### Mapping to OpenCode

ACP sessions map cleanly to opencode's internal session model:

- ACP `session/new` → creates internal Session
- ACP `session/prompt` → uses SessionPrompt.prompt()
- Working directory context preserved per-session
- Tool execution uses existing ToolRegistry

## References

- [ACP Specification](https://agentclientprotocol.com/)
- [TypeScript Library](https://github.com/agentclientprotocol/typescript-sdk)
- [Protocol Examples](https://github.com/agentclientprotocol/typescript-sdk/tree/main/src/examples)
