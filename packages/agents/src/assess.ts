import type { RoleId, StoppedReason } from "@eng/core"
import { ClaudeWorker } from "./claude-worker"
import { extractJson } from "./propose"

export interface AssessInput {
  role: RoleId
  systemPrompt: string
  goalContext: string
  /** What to verify. */
  task: string
  budgetCentsRemaining: number
}

export interface Assessment {
  passed: boolean
  summary: string
  costCents: number
  stoppedReason: StoppedReason
}

const CONTRACT =
  'Respond with ONLY a JSON object {"passed": boolean, "summary": string}. Set passed=true only if ' +
  "the acceptance criteria are fully met."

/** Run a verification agent and parse a pass/fail verdict from its response. */
export async function assess(input: AssessInput): Promise<Assessment> {
  const result = await new ClaudeWorker().run({
    role: input.role,
    systemPrompt: input.systemPrompt,
    tools: [],
    goalContext: input.goalContext,
    task: `${input.task}\n\n${CONTRACT}`,
    budgetCentsRemaining: input.budgetCentsRemaining,
  })
  const { passed, summary } = parseVerdict(result.summary)
  return { passed, summary, costCents: result.costCents, stoppedReason: result.stoppedReason }
}

/** Best-effort verdict extraction. Defaults to `passed: false` (strict QA) when unparseable. */
export function parseVerdict(text: string): { passed: boolean; summary: string } {
  const json = extractJson(text)
  if (json) {
    try {
      const obj = JSON.parse(json) as { passed?: unknown; summary?: unknown }
      return {
        passed: obj.passed === true,
        summary: typeof obj.summary === "string" ? obj.summary : text.trim(),
      }
    } catch {
      // fall through
    }
  }
  return { passed: false, summary: text.trim() }
}
