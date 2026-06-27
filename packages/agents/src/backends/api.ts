import Anthropic from "@anthropic-ai/sdk"
import type { WorkerInput, WorkerResult } from "@eng/core"
import type { WorkerBackend } from "../claude-worker"
import { affordableMaxTokens, costCentsFromUsage } from "../pricing"
import { buildSystemPrompt, supportsAdaptiveThinking } from "../prompt"

/** Worker backend that calls the Anthropic Messages API directly via `@anthropic-ai/sdk`. */
export class ApiBackend implements WorkerBackend {
  private readonly client: Anthropic

  constructor(private readonly model: string) {
    // Resolves credentials from the environment (ANTHROPIC_API_KEY / auth token / `ant` profile).
    this.client = new Anthropic()
  }

  async run(input: WorkerInput, signal?: AbortSignal): Promise<WorkerResult> {
    // A whole-component implementation easily exceeds 16K output tokens; at 16K it was silently
    // truncated mid-JSON and dropped as "could not be parsed". Allow more headroom and stream — the
    // skill's guidance is to stream any request with high `max_tokens` to avoid request timeouts.
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: affordableMaxTokens(this.model, input.budgetCentsRemaining, 32000),
        // Adaptive thinking only where the model supports it — Haiku 4.5 / older 400 on it.
        ...(supportsAdaptiveThinking(this.model)
          ? { thinking: { type: "adaptive" as const } }
          : {}),
        system: buildSystemPrompt(input),
        messages: [{ role: "user", content: input.task }],
        // Structured outputs (ENG-009): constrain the model to schema-conforming JSON when a schema
        // is supplied, so callers parse guaranteed-valid JSON instead of best-effort extraction.
        ...(input.outputSchema
          ? {
              output_config: {
                format: { type: "json_schema" as const, schema: input.outputSchema },
              },
            }
          : {}),
      },
      { signal },
    )
    const response = await stream.finalMessage()

    const summary = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim()

    // Hitting the output cap leaves any JSON incomplete — surface it as `truncated` so the caller can
    // audit it honestly instead of treating the cut-off text as an unparseable agent failure.
    const stoppedReason =
      response.stop_reason === "refusal"
        ? "blocked"
        : response.stop_reason === "max_tokens"
          ? "truncated"
          : "completed"

    return {
      summary: summary || `[${input.role}] (no text returned)`,
      toolCalls: [],
      costCents: costCentsFromUsage(this.model, response.usage),
      stoppedReason,
    }
  }
}
