import type { ConsensusInputMode, Rating, RoleId, StoppedReason } from "@eng/core"
import { ClaudeWorker } from "./claude-worker"
import { extractJson } from "./propose"

/**
 * Candidate generation + rater agents for Kappa-style consensus (ENG-016). `proposeDirections`
 * enumerates 2–4 genuinely distinct implementation directions; `rateDirections` has one role agent
 * **independently** score/rank them via structured outputs (ENG-009). Independence is procedural:
 * each rater is a separate run that never sees another rater's input — what makes the agreement
 * coefficient meaningful (the judge-panel pattern).
 */

export interface ProposeDirectionsInput {
  role: RoleId
  systemPrompt: string
  goalContext: string
  /** What feature/decision to enumerate directions for. */
  task: string
  budgetCentsRemaining: number
  /** Upper bound on candidates (PRD: 2–4). Default 4. */
  maxCandidates?: number
}

export interface ProposedDirection {
  title: string
  summary: string
  tradeoffs: string[]
}

export interface ProposedDirections {
  candidates: ProposedDirection[]
  costCents: number
  stoppedReason: StoppedReason
}

const DIRECTIONS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "tradeoffs"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          tradeoffs: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
}

/** Run an agent to enumerate distinct candidate implementation directions for a feature. */
export async function proposeDirections(
  input: ProposeDirectionsInput,
): Promise<ProposedDirections> {
  const max = input.maxCandidates ?? 4
  const contract =
    `Propose between 2 and ${max} GENUINELY DISTINCT implementation directions — not variations of ` +
    "one idea. For each give a short title, a one-paragraph summary, and its key tradeoffs. Respond " +
    'with ONLY {"candidates":[{"title":string,"summary":string,"tradeoffs":[string]}]}.'
  const result = await new ClaudeWorker().run({
    role: input.role,
    systemPrompt: input.systemPrompt,
    tools: [],
    goalContext: input.goalContext,
    task: `${input.task}\n\n${contract}`,
    budgetCentsRemaining: input.budgetCentsRemaining,
    outputSchema: DIRECTIONS_SCHEMA,
  })
  return {
    candidates: parseDirections(result.summary, max),
    costCents: result.costCents,
    stoppedReason: result.stoppedReason,
  }
}

/** Best-effort extraction of candidate directions; bounded to `max`. */
export function parseDirections(text: string, max = 4): ProposedDirection[] {
  const json = extractJson(text)
  if (!json) return []
  try {
    const obj = JSON.parse(json) as { candidates?: unknown }
    if (!Array.isArray(obj.candidates)) return []
    return obj.candidates
      .filter(
        (c): c is ProposedDirection =>
          !!c &&
          typeof (c as ProposedDirection).title === "string" &&
          typeof (c as ProposedDirection).summary === "string",
      )
      .map((c) => ({
        title: c.title,
        summary: c.summary,
        tradeoffs: Array.isArray(c.tradeoffs)
          ? c.tradeoffs.filter((t) => typeof t === "string")
          : [],
      }))
      .slice(0, max)
  } catch {
    return []
  }
}

export interface RateDirectionsInput {
  role: RoleId
  systemPrompt: string
  goalContext: string
  candidates: { id: string; title: string; summary: string }[]
  criteria: string[]
  inputMode: ConsensusInputMode
  budgetCentsRemaining: number
}

export interface RaterResult {
  rating: Rating
  costCents: number
  stoppedReason: StoppedReason
}

/** Schema constraining the rater to the actual candidate ids (single-pick or full ranking). */
function ratingSchema(ids: string[], mode: ConsensusInputMode): Record<string, unknown> {
  if (mode === "pick") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["pick", "rationale"],
      properties: { pick: { type: "string", enum: ids }, rationale: { type: "string" } },
    }
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["ranking", "rationale"],
    properties: {
      ranking: { type: "array", items: { type: "string", enum: ids } },
      rationale: { type: "string" },
    },
  }
}

/** Run ONE rater independently over the candidates, returning a structured `Rating`. */
export async function rateDirections(input: RateDirectionsInput): Promise<RaterResult> {
  const ids = input.candidates.map((c) => c.id)
  const list = input.candidates.map((c) => `[${c.id}] ${c.title}: ${c.summary}`).join("\n")
  const instruction =
    input.inputMode === "pick"
      ? 'Pick the single best candidate. Respond with ONLY {"pick":"<candidate id>","rationale":string}.'
      : 'Rank ALL candidates from best to worst by id. Respond with ONLY {"ranking":["<id>",...],"rationale":string}.'
  const task =
    `Independently evaluate these candidate implementation directions against the rubric ` +
    `(${input.criteria.join(", ")}). Judge on the merits; you are not seeing other reviewers' views.\n\n` +
    `Candidates:\n${list}\n\n${instruction}`

  const result = await new ClaudeWorker().run({
    role: input.role,
    systemPrompt: input.systemPrompt,
    tools: [],
    goalContext: input.goalContext,
    task,
    budgetCentsRemaining: input.budgetCentsRemaining,
    outputSchema: ratingSchema(ids, input.inputMode),
  })
  return {
    rating: parseRating(result.summary, input.role, ids, input.inputMode, result.costCents),
    costCents: result.costCents,
    stoppedReason: result.stoppedReason,
  }
}

/** Best-effort rating extraction, constrained to known candidate ids. Defaults to an abstention. */
export function parseRating(
  text: string,
  role: RoleId,
  ids: string[],
  mode: ConsensusInputMode,
  costCents: number,
): Rating {
  const base: Rating = {
    raterRole: role,
    pick: null,
    ranking: [],
    rationale: text.trim(),
    costCents,
  }
  const json = extractJson(text)
  if (!json) return base
  try {
    const obj = JSON.parse(json) as { pick?: unknown; ranking?: unknown; rationale?: unknown }
    const rationale = typeof obj.rationale === "string" ? obj.rationale : base.rationale
    if (mode === "pick") {
      const pick = typeof obj.pick === "string" && ids.includes(obj.pick) ? obj.pick : null
      return { ...base, pick, rationale }
    }
    const ranking = Array.isArray(obj.ranking)
      ? [
          ...new Set(
            obj.ranking.filter((r): r is string => typeof r === "string" && ids.includes(r)),
          ),
        ]
      : []
    return { ...base, ranking, rationale }
  } catch {
    return base
  }
}
