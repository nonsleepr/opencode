/**
 * Core types for the Resource abstraction layer.
 * Resources are any contextual data that can be referenced via URI (files, sessions, docs, etc.)
 */

/**
 * A resource that can be referenced and read
 */
export interface Resource {
  /** Unique URI identifier (e.g., file:///path, opencode://session/123) */
  uri: string
  /** Display name for UI */
  name: string
  /** Optional description */
  description?: string
  /** MIME type (e.g., text/plain, application/json) */
  mimeType?: string
  /** Provider-specific metadata */
  metadata?: {
    /** Optional prefix for display (e.g., "[server]", "🤖") */
    prefix?: string
    /** Client/server name for routing (used as fallback prefix) */
    clientName?: string
    [key: string]: any
  }
}

/**
 * Content of a resource
 */
export interface ResourceContent {
  /** URI of the resource */
  uri: string
  /** MIME type */
  mimeType: string
  /** Text content (for text resources) */
  text?: string
  /** Binary content as base64 (for binary resources) */
  blob?: string
}

/**
 * Resource provider interface - plugins implement this to provide custom resources
 */
export interface ResourceProvider {
  /** Unique name for this provider (e.g., "file", "session", "github") */
  name: string

  /** URI schemes this provider handles (e.g., ["file"], ["opencode"], ["git"]) */
  schemes: string[]

  /**
   * Search for resources matching the query
   * @param query Search query string
   * @param limit Maximum number of results
   * @returns Array of matching resources with prefix for provider identification
   */
  search(query: string, limit: number): Promise<Resource[]>

  /**
   * Read the content of a resource
   * @param uri Resource URI
   * @returns Resource content
   */
  read(uri: string): Promise<ResourceContent>

  /**
   * Optional: Subscribe to resource changes (for MCP compatibility)
   * @param uri Resource URI to watch
   * @param callback Called when resource changes
   */
  subscribe?(uri: string, callback: (uri: string) => void): Promise<void>
}

/**
 * Resource with annotated display information
 */
export interface AnnotatedResource extends Resource {
  /** Provider that owns this resource */
  providerName: string
}
