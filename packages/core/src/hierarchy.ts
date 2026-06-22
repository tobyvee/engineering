/** A node in the goal hierarchy (a goal or an epic), identified by an opaque backend id. */
export interface HierarchyNode {
  id: string
  title: string
}

/**
 * The goal hierarchy (mission → goal → epic → ticket). Resolves a ticket's trace as the prompt-ready
 * "why" injected into every agent session (invariant #1), and supports authoring goals/epics so work
 * can be decomposed under multiple epics. A boundary (invariant #5): backed by Postgres rows or
 * native GitHub sub-issues behind one interface.
 */
export interface Hierarchy {
  traceContext(ticketId: string): Promise<string>
  /** The mission→goal→epic context for an epic — the "why" fed to the Lead Engineer when it
   *  decomposes the epic into tickets. */
  epicContext(epicId: string): Promise<string>
  listGoals(): Promise<HierarchyNode[]>
  createGoal(input: { title: string; description?: string }): Promise<HierarchyNode>
  /** Epics, optionally scoped to a goal. */
  listEpics(goalId?: string): Promise<HierarchyNode[]>
  /** Create an epic under a goal (defaults to the seeded goal when `goalId` is omitted). */
  createEpic(input: {
    title: string
    description?: string
    goalId?: string
  }): Promise<HierarchyNode>
}
