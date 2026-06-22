import type { Worker } from "@eng/core"
import { ClaudeWorker } from "./claude-worker"

export { ClaudeWorker }

/** Factory for the default unit Worker runtime. */
export function createWorker(): Worker {
  return new ClaudeWorker()
}
