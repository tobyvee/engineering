/**
 * Resolves a ticket's goal-hierarchy trace (mission → goal → epic → ticket) as the prompt-ready
 * "why" injected into every agent session (invariant #1). A boundary (invariant #5): backed by
 * Postgres joins, or a GitHub-stored hierarchy, behind one interface.
 */
export interface Hierarchy {
  traceContext(ticketId: string): Promise<string>
}
