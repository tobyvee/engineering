import type { Decision } from "./schema"

/**
 * Append-only (invariant #2): no update, no delete. A decision *references* audit events and KB
 * artifacts — it never copies them. `id`/`at` are assigned on `record`.
 */
export type NewDecision = Omit<Decision, "id" | "at">

/** Work-item refs a decision can be attached to (the Mission→Goal→Epic→Ticket spine). */
export interface WorkItemRef {
  ticketId?: string
  epicId?: string
  goalId?: string
  missionId?: string
}

/**
 * The decision-provenance port (ENG-014): a queryable, linked layer over the append-only audit log
 * and the work hierarchy. Decisions form a DAG traceable to the originating request. Backend-pluggable
 * (Postgres index + KB body, or GitHub-doc) like the other `core` ports — `core` depends only on this
 * interface (invariant #5).
 */
export interface DecisionLog {
  /** Append a decision node. Append-only — returns the persisted record with `id`/`at`. */
  record(decision: NewDecision): Promise<Decision>
  get(id: string): Promise<Decision | null>
  /** Every decision in a trace (same `rootRequestId`), newest first. */
  listByRoot(rootRequestId: string): Promise<Decision[]>
  /** Decisions attached to a work item (ticket / epic / goal / mission). */
  byWorkItem(ref: WorkItemRef): Promise<Decision[]>
  /**
   * Walk parent edges from a decision up to the root request — the provenance chain. Returns the
   * path from the given decision (first) to the root (last); empty if the id is unknown. On a DAG
   * with multiple parents, follows all reachable ancestors (deduplicated).
   */
  traverseToRoot(id: string): Promise<Decision[]>
}

/**
 * Pure provenance traversal: from `start`, walk parent edges (a DAG) over an in-memory index,
 * returning the start decision first then all reachable ancestors, deduplicated (BFS). Empty when the
 * start id is unknown. Shared by backends so the graph-walk logic is single-sourced and unit-tested.
 */
export function traceToRoot(start: string, byId: Map<string, Decision>): Decision[] {
  const path: Decision[] = []
  const seen = new Set<string>()
  let frontier = [start]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      const d = byId.get(id)
      if (!d) continue
      path.push(d)
      for (const parent of d.parentDecisionIds) if (!seen.has(parent)) next.push(parent)
    }
    frontier = next
  }
  return path
}
