/** A document in the knowledge base (e.g. a Markdown page). */
export interface Doc {
  path: string
  content: string
}

/**
 * Read/write store for agent-facing documentation & knowledge (the KB / wiki). A boundary
 * (invariant #5): backed by GitHub repo docs, Postgres, etc. behind one interface.
 */
export interface KnowledgeBase {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  /** Paths under an optional prefix. */
  list(prefix?: string): Promise<string[]>
}
