import type { Resource, ResourceProvider, ResourceContent, AnnotatedResource } from "./types"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import fuzzysort from "fuzzysort"

const log = Log.create({ service: "resource-registry" })

const SEARCH_TIMEOUT_MS = 2000 // 2 second timeout for plugin searches

export namespace ResourceRegistry {
  const state = Instance.state(async () => {
    const providers: ResourceProvider[] = []
    return { providers }
  })

  /**
   * Register a resource provider
   * Prevents duplicate registration of providers with the same name
   */
  export async function register(provider: ResourceProvider) {
    const s = await state()

    // Check if provider with same name already exists
    const existing = s.providers.find((p) => p.name === provider.name)
    if (existing) {
      log.warn("provider already registered, skipping duplicate", {
        name: provider.name,
        schemes: provider.schemes,
      })
      return
    }

    log.info("registering provider", { name: provider.name, schemes: provider.schemes })
    s.providers.push(provider)
  }

  /**
   * Unregister a resource provider
   */
  export async function unregister(providerName: string) {
    const s = await state()
    s.providers = s.providers.filter((p) => p.name !== providerName)
  }

  /**
   * Get all registered providers
   */
  export async function list(): Promise<ResourceProvider[]> {
    const s = await state()
    return s.providers
  }

  /**
   * Search for resources across all providers
   * Results are mixed and scored by relevance
   */
  export async function search(query: string, limit: number): Promise<AnnotatedResource[]> {
    const s = await state()
    log.info("searching resources", { query, limit, providerCount: s.providers.length })

    // Search all providers in parallel with timeout
    const searchPromises = s.providers.map(async (provider) => {
      try {
        const timeoutPromise = new Promise<Resource[]>((_, reject) =>
          setTimeout(() => reject(new Error("Search timeout")), SEARCH_TIMEOUT_MS),
        )
        const searchPromise = provider.search(query, limit)
        const results = await Promise.race([searchPromise, timeoutPromise])

        return results.map((r) => ({ resource: r, provider }))
      } catch (err) {
        log.warn("provider search failed", { provider: provider.name, error: err })
        return []
      }
    })

    const allResults = await Promise.all(searchPromises)

    // Flatten and score
    const scored = allResults
      .flat()
      .map((item) => ({
        ...item,
        score: calculateRelevanceScore(item.resource, query),
      }))
      .sort((a, b) => b.score - a.score)

    // Apply limit and annotate
    const topResults = scored.slice(0, limit)
    log.info("search results", {
      query,
      total: allResults.flat().length,
      returned: topResults.length,
    })

    return topResults.map((item) => annotateResource(item.resource, item.provider))
  }

  /**
   * Read a resource by URI
   * Routes to the appropriate provider based on URI scheme
   */
  export async function read(uri: string): Promise<ResourceContent> {
    const s = await state()
    const url = new URL(uri)
    const scheme = url.protocol.slice(0, -1) // Remove trailing ':'

    // Find provider for this scheme
    const provider = s.providers.find((p) => p.schemes.includes(scheme))
    if (!provider) {
      throw new Error(`No resource provider registered for scheme: ${scheme}`)
    }

    log.info("reading resource", { uri, provider: provider.name })
    return await provider.read(uri)
  }

  /**
   * Calculate relevance score for a resource given a query
   */
  function calculateRelevanceScore(resource: Resource, query: string): number {
    const lowerQuery = query.toLowerCase()
    const lowerName = resource.name.toLowerCase()
    const lowerDesc = resource.description?.toLowerCase() ?? ""

    let score = 0

    // Exact name match: highest priority
    if (lowerName === lowerQuery) score += 100

    // Name starts with query: high priority
    if (lowerName.startsWith(lowerQuery)) score += 50

    // Name contains query: medium priority
    if (lowerName.includes(lowerQuery)) score += 25

    // Description contains query: low priority
    if (lowerDesc.includes(lowerQuery)) score += 10

    // Bonus for file:// scheme (prioritize local files slightly)
    if (resource.uri.startsWith("file://")) score += 5

    // Use fuzzysort for additional scoring
    const fuzzyResult = fuzzysort.single(query, resource.name)
    if (fuzzyResult) {
      score += Math.max(0, fuzzyResult.score / 100) // Normalize fuzzy score
    }

    return score
  }

  /**
   * Annotate a resource with provider information
   */
  function annotateResource(resource: Resource, provider: ResourceProvider): AnnotatedResource {
    return {
      ...resource,
      providerName: provider.name,
    }
  }
}
