import type { Resource, ResourceProvider, ResourceContent } from "../types"
import { Agent } from "../../agent/agent"

/**
 * Resource provider for agent:// URIs
 * Allows referencing agents via @agent-name
 */
export class AgentResourceProvider implements ResourceProvider {
  name = "agent"
  schemes = ["agent"]

  async search(query: string, limit: number): Promise<Resource[]> {
    const agents = await Agent.list()

    // Filter: non-hidden, name contains query
    const matches = agents
      .filter((a) => !a.hidden && a.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit)

    return matches.map((a) => ({
      uri: `agent://${a.name}`,
      name: a.name,
      description: a.description,
      mimeType: "application/x-opencode-agent",
      metadata: {
        prefix: "🤖",
      },
    }))
  }

  async read(uri: string): Promise<ResourceContent> {
    const agentName = uri.replace("agent://", "")

    // Return synthetic instruction (same as current AgentPart behavior)
    const text = `Use the above message and context to generate a prompt and call the task tool with subagent: ${agentName}`

    return {
      uri,
      mimeType: "application/x-opencode-agent",
      text,
    }
  }
}
