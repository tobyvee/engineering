import type { RoleId } from "./schema"

/**
 * The agent-runtime boundary. `core` never calls the Claude Agent SDK directly — it goes through
 * this interface (invariant #5). The default implementation lives in `@eng/agents`; swapping the
 * runtime must not touch `core`.
 */
export interface WorkerInput {
  role: RoleId
  systemPrompt: string
  /** Allow-listed tools for this session. */
  tools: string[]
  /** The mission → goal → epic → ticket context, injected into every session (invariant #1). */
  goalContext: string
  /** The concrete task for this run. */
  task: string
  /** Remaining budget; the orchestrator stops the session if this is exhausted (invariant #3). */
  budgetCentsRemaining: number
  /**
   * Optional JSON Schema for the response (ENG-009). Runtimes that support structured outputs (the
   * API backend) constrain the model to emit schema-conforming JSON; runtimes that don't (the CLI
   * backend) ignore it and fall back to prompt-contract parsing.
   */
  outputSchema?: Record<string, unknown>
  /**
   * Optional working directory for the run (ENG-001). When set (e.g. a cloned target repo in the
   * working-code workspace), the CLI backend runs the agent there — so it reads and edits real source
   * — and does NOT clean it up. When unset, the backend uses a throwaway agent-state sandbox.
   */
  workdir?: string
}

export interface ToolCallRecord {
  name: string
  input: unknown
  output: unknown
  at: string
}

export type StoppedReason =
  | "completed"
  | "budget_exhausted"
  | "needs_approval"
  | "blocked"
  /** Output hit the token cap and was cut off — any JSON is incomplete (do not trust `summary`). */
  | "truncated"

export interface WorkerResult {
  summary: string
  toolCalls: ToolCallRecord[]
  costCents: number
  stoppedReason: StoppedReason
}

export interface Worker {
  run(input: WorkerInput, signal?: AbortSignal): Promise<WorkerResult>
}
