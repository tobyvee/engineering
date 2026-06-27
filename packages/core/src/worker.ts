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
}

export interface ToolCallRecord {
  name: string
  input: unknown
  output: unknown
  at: string
}

export type StoppedReason = "completed" | "budget_exhausted" | "needs_approval" | "blocked"

export interface WorkerResult {
  summary: string
  toolCalls: ToolCallRecord[]
  costCents: number
  stoppedReason: StoppedReason
}

export interface Worker {
  run(input: WorkerInput, signal?: AbortSignal): Promise<WorkerResult>
}
