import type { Worker } from "@eng/core"
import { ClaudeWorker, type ClaudeWorkerOptions } from "./claude-worker"

export { type AssessInput, type Assessment, assess, parseVerdict } from "./assess"
export type { ClaudeWorkerOptions, WorkerBackend, WorkerMode } from "./claude-worker"
export { ClaudeWorker } from "./claude-worker"
export {
  type ProposedTicket,
  type ProposedTickets,
  type ProposeTicketsInput,
  parseTickets,
  proposeTickets,
} from "./decompose"
export { type DraftedArtifact, type DraftInput, draft } from "./draft"
export { DEFAULT_MODEL } from "./prompt"
export {
  isParseableJson,
  type ProposeChangesInput,
  type ProposedChanges,
  parseProposal,
  proposeFileChanges,
} from "./propose"
export {
  type CloneResult,
  ensureRepoCloned,
  type RepoTarget,
  repoTargetFromEnv,
} from "./provision"
export { PROPOSAL_SCHEMA, TICKETS_SCHEMA, VERDICT_SCHEMA } from "./schemas"
export { repoWorkspacePath, resolveCodeWorkspaceRoot } from "./workspace"

/** Factory for the default unit Worker runtime (mode from options or the WORKER_MODE env var). */
export function createWorker(options?: ClaudeWorkerOptions): Worker {
  return new ClaudeWorker(options)
}
