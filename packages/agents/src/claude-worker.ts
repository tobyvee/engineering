import type { Worker, WorkerInput, WorkerResult } from "@eng/core"
import { ApiBackend } from "./backends/api"
import { CliBackend } from "./backends/cli"
import { DEFAULT_MODEL } from "./prompt"

/** A concrete transport for running one agent session. */
export interface WorkerBackend {
  run(input: WorkerInput, signal?: AbortSignal): Promise<WorkerResult>
}

/** `api` → Anthropic Messages API; `cli` → the `claude -p` CLI over stdio. */
export type WorkerMode = "api" | "cli"

export interface ClaudeWorkerOptions {
  mode?: WorkerMode
  model?: string
}

export function resolveMode(explicit?: WorkerMode): WorkerMode {
  const mode = explicit ?? (process.env.WORKER_MODE as WorkerMode | undefined)
  return mode === "cli" ? "cli" : "api"
}

/**
 * Default `Worker` implementation — wraps the Claude Agent runtime behind two interchangeable
 * backends. `core` only ever sees the `Worker` interface (invariant #5), so swapping API ↔ CLI (or
 * adding another runtime) never touches the domain. The backend is constructed lazily so the budget
 * guard can short-circuit without spinning up a client or subprocess.
 */
export class ClaudeWorker implements Worker {
  private readonly mode: WorkerMode
  private readonly model: string
  private backendInstance?: WorkerBackend

  constructor(options: ClaudeWorkerOptions = {}) {
    this.mode = resolveMode(options.mode)
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL
  }

  private backend(): WorkerBackend {
    if (!this.backendInstance) {
      this.backendInstance =
        this.mode === "cli" ? new CliBackend(this.model) : new ApiBackend(this.model)
    }
    return this.backendInstance
  }

  async run(input: WorkerInput, signal?: AbortSignal): Promise<WorkerResult> {
    if (input.budgetCentsRemaining <= 0) {
      return {
        summary: `[${input.role}] skipped: budget exhausted`,
        toolCalls: [],
        costCents: 0,
        stoppedReason: "budget_exhausted",
      }
    }
    return this.backend().run(input, signal)
  }
}
