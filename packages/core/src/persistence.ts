import type { AuditLog } from "./audit"
import type { Hierarchy } from "./hierarchy"
import type { KnowledgeBase } from "./knowledge"
import type { IssueTracker } from "./tracker"

/** Which backend the persistence layer is assembled from. */
export type PersistenceBackend = "github" | "postgres"

/**
 * The agents' persistence layer — the ports the orchestrator persists state through. Each port can
 * be backed by a different implementation (GitHub, Postgres, …), assembled by a factory. `core`
 * depends only on these interfaces, never on a concrete backend (invariant #5).
 */
export interface Persistence {
  tracker: IssueTracker
  knowledge: KnowledgeBase
  hierarchy: Hierarchy
  audit: AuditLog
}
