import type { Worker, WorkerInput, WorkerResult } from "@eng/core"

/**
 * Default Worker implementation — wraps the Claude Agent SDK. `core` only ever sees the `Worker`
 * interface (invariant #5), so this runtime can be swapped without touching the domain.
 */
export class ClaudeWorker implements Worker {
  async run(input: WorkerInput, _signal?: AbortSignal): Promise<WorkerResult> {
    // TODO: open a Claude Agent SDK session with `input.systemPrompt` and the scoped `input.tools`,
    // inject `input.goalContext`, stream the run, capture every tool call into the audit log, and
    // stop when `input.budgetCentsRemaining` is exhausted.
    return {
      summary: `[${input.role}] ClaudeWorker is not yet wired to the Claude Agent SDK`,
      toolCalls: [],
      costCents: 0,
      stoppedReason: "completed",
    }
  }
}
