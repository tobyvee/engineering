import type { RoleId, StoppedReason } from "@eng/core"
import { ClaudeWorker } from "./claude-worker"

export interface DraftInput {
  role: RoleId
  systemPrompt: string
  goalContext: string
  /** What to produce (e.g. requirements, a design spec, an ADR). */
  task: string
  budgetCentsRemaining: number
}

export interface DraftedArtifact {
  content: string
  costCents: number
  stoppedReason: StoppedReason
}

/**
 * Run an agent to draft a prose artifact (requirements, design spec, ADR, …). Unlike file/ticket
 * proposals there's no structured parsing — the artifact *is* the agent's response.
 */
export async function draft(input: DraftInput): Promise<DraftedArtifact> {
  const result = await new ClaudeWorker().run({
    role: input.role,
    systemPrompt: input.systemPrompt,
    tools: [],
    goalContext: input.goalContext,
    task: input.task,
    budgetCentsRemaining: input.budgetCentsRemaining,
  })
  return {
    content: result.summary,
    costCents: result.costCents,
    stoppedReason: result.stoppedReason,
  }
}
