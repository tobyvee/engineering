import type { Worker } from "@eng/core"
import { ClaudeWorker, type ClaudeWorkerOptions } from "./claude-worker"

export type { ClaudeWorkerOptions, WorkerBackend, WorkerMode } from "./claude-worker"
export { ClaudeWorker } from "./claude-worker"
export { DEFAULT_MODEL } from "./prompt"
export {
  type ProposeChangesInput,
  type ProposedChanges,
  parseProposal,
  proposeFileChanges,
} from "./propose"

/** Factory for the default unit Worker runtime (mode from options or the WORKER_MODE env var). */
export function createWorker(options?: ClaudeWorkerOptions): Worker {
  return new ClaudeWorker(options)
}
