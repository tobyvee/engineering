import type { Decision, DecisionLog, NewDecision, WorkItemRef } from "@eng/core"
import {
  getDecision,
  listDecisionsByRoot,
  listDecisionsByWorkItem,
  recordDecision,
  traverseDecisionToRoot,
} from "./repo"

/** DecisionLog backed by Postgres (the append-only `decisions` table) — ENG-014. */
export class DbDecisionLog implements DecisionLog {
  record(decision: NewDecision): Promise<Decision> {
    return recordDecision(decision)
  }

  get(id: string): Promise<Decision | null> {
    return getDecision(id)
  }

  listByRoot(rootRequestId: string): Promise<Decision[]> {
    return listDecisionsByRoot(rootRequestId)
  }

  byWorkItem(ref: WorkItemRef): Promise<Decision[]> {
    return listDecisionsByWorkItem(ref)
  }

  traverseToRoot(id: string): Promise<Decision[]> {
    return traverseDecisionToRoot(id)
  }
}
