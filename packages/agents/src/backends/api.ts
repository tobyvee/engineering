import Anthropic from "@anthropic-ai/sdk"
import type { WorkerInput, WorkerResult } from "@eng/core"
import type { WorkerBackend } from "../claude-worker"
import { affordableMaxTokens, costCentsFromUsage } from "../pricing"
import { buildSystemPrompt } from "../prompt"

/** Worker backend that calls the Anthropic Messages API directly via `@anthropic-ai/sdk`. */
export class ApiBackend implements WorkerBackend {
  private readonly client: Anthropic

  constructor(private readonly model: string) {
    // Resolves credentials from the environment (ANTHROPIC_API_KEY / auth token / `ant` profile).
    this.client = new Anthropic()
  }

  async run(input: WorkerInput, signal?: AbortSignal): Promise<WorkerResult> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: affordableMaxTokens(this.model, input.budgetCentsRemaining, 16000),
        thinking: { type: "adaptive" },
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

    const summary = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim()

    return {
      summary: summary || `[${input.role}] (no text returned)`,
      toolCalls: [],
      costCents: costCentsFromUsage(this.model, response.usage),
      stoppedReason: response.stop_reason === "refusal" ? "blocked" : "completed",
    }
  }
}
