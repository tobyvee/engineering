import type { WorkerInput } from "@eng/core"

/** Default model for agent runs. Opus 4.8 supports adaptive thinking. */
export const DEFAULT_MODEL = "claude-opus-4-8"

/** Models that accept `thinking: {type:"adaptive"}`. Others (Haiku 4.5, Sonnet 4.5, older) reject it
 *  with a 400, so the API backend must omit the param for them. */
const ADAPTIVE_THINKING_MODELS = new Set([
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-fable-5",
  "claude-mythos-5",
])

/** Whether `model` supports adaptive thinking (so the API backend should send the `thinking` param). */
export function supportsAdaptiveThinking(model: string): boolean {
  return ADAPTIVE_THINKING_MODELS.has(model)
}

/**
 * Compose the session system prompt: the role persona plus the mission→goal→epic→ticket context,
 * so every agent always has the *why* (invariant #1).
 */
export function buildSystemPrompt(input: WorkerInput): string {
  return [
    input.systemPrompt,
    "",
    "## Goal context (mission → goal → epic → ticket)",
    input.goalContext,
    "",
    `Tools available to you: ${input.tools.join(", ") || "none"}.`,
  ].join("\n")
}
