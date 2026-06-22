import type { WorkerInput } from "@eng/core"

/** Default model for agent runs. Opus 4.8 supports adaptive thinking. */
export const DEFAULT_MODEL = "claude-opus-4-8"

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
