import { z } from "zod"
import { type AgreementMetric, agreement } from "./agreement"
import { RoleId } from "./schema"

/**
 * Kappa-style consensus (ENG-016 / PRD-001): at the architecture / system-design stage the senior
 * technical roles independently rate candidate implementation directions; an inter-rater agreement
 * coefficient gates whether a clear winner is adopted or sent to a tie-breaker. Schemas + the pure
 * aggregation/decision rule live here; the agreement math is in `./agreement`.
 */

const id = z.string()

/** One candidate implementation direction for a feature. */
export const ConsensusCandidate = z.object({
  id,
  title: z.string(),
  summary: z.string(),
  tradeoffs: z.array(z.string()),
})
export type ConsensusCandidate = z.infer<typeof ConsensusCandidate>

export const ConsensusInputMode = z.enum(["pick", "rank"])
export type ConsensusInputMode = z.infer<typeof ConsensusInputMode>

export const ConsensusTieBreaker = z.enum(["human", "casting_vote"])
export type ConsensusTieBreaker = z.infer<typeof ConsensusTieBreaker>

/** One rater's assessment — a single pick or a full ranking, plus their rationale. */
export const Rating = z.object({
  raterRole: RoleId,
  /** Single-pick mode: the chosen candidate id (null if abstained / wrong mode). */
  pick: id.nullable(),
  /** Ranked mode: candidate ids best→worst (empty in pick mode). */
  ranking: z.array(id),
  rationale: z.string(),
  costCents: z.number().nullable(),
})
export type Rating = z.infer<typeof Rating>

/** Per-unit consensus configuration (config, not code — invariant #6). */
export const ConsensusConfig = z.object({
  inputMode: ConsensusInputMode,
  /** Agreement gate; Landis–Koch "substantial" ≈ 0.6 by default. */
  threshold: z.number(),
  tieBreaker: ConsensusTieBreaker,
  /** Rubric criteria keys raters score against. */
  criteria: z.array(z.string()),
  raterRoles: z.array(RoleId),
  /** Phase 1: record the round + score but don't block the lifecycle (advisory). */
  advisory: z.boolean(),
})
export type ConsensusConfig = z.infer<typeof ConsensusConfig>

export const ConsensusRoundStatus = z.enum(["rating", "decided", "tie_break", "resolved"])
export type ConsensusRoundStatus = z.infer<typeof ConsensusRoundStatus>

export const ConsensusRound = z.object({
  id,
  epicId: id,
  featureId: id.nullable(),
  candidates: z.array(ConsensusCandidate),
  criteria: z.array(z.string()),
  raterRoles: z.array(RoleId),
  status: ConsensusRoundStatus,
})
export type ConsensusRound = z.infer<typeof ConsensusRound>

export const ConsensusOutcome = z.object({
  roundId: id,
  winner: id.nullable(),
  consensusReached: z.boolean(),
  coefficient: z.number(),
  metric: z.string(),
  aggregateMethod: z.string(),
  tieBreaker: z.object({ type: ConsensusTieBreaker, decidedBy: z.string().nullable() }).nullable(),
})
export type ConsensusOutcome = z.infer<typeof ConsensusOutcome>

export interface CandidateScore {
  candidateId: string
  score: number
}

export interface ConsensusDecision {
  winner: string | null
  consensusReached: boolean
  coefficient: number
  metric: AgreementMetric
  aggregateMethod: "votes" | "borda"
  scores: CandidateScore[]
}

/** The default rubric + thresholds; per-unit overridable (invariant #6). Phase 1 = advisory. */
export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  inputMode: "rank",
  threshold: 0.6,
  tieBreaker: "human",
  criteria: [
    "simplicity",
    "scalability",
    "delivery_risk",
    "adr_alignment",
    "cost_to_build",
    "reversibility",
    "testability",
  ],
  raterRoles: ["lead_system_design", "lead_architect", "lead_engineer"],
  advisory: true,
}

/**
 * Pure aggregation + agreement gate (PRD §decision rule). The **aggregate winner** (vote tally for
 * single-pick, Borda count for rankings) is primary; the **coefficient** gates whether that winner is
 * trusted (consensus) or routed to the tie-breaker. `consensusReached` requires both a *clear* winner
 * (no tie for the top) and `coefficient ≥ threshold`.
 */
export function decide(
  candidates: ReadonlyArray<{ id: string }>,
  ratings: ReadonlyArray<Rating>,
  config: ConsensusConfig,
): ConsensusDecision {
  const ids = candidates.map((c) => c.id)
  const colOf = new Map(ids.map((cid, i) => [cid, i]))
  const N = ids.length

  if (config.inputMode === "pick") {
    const selectionMatrix: (number | null)[][] = ids.map(() => ratings.map(() => 0))
    const votes = new Array<number>(N).fill(0)
    ratings.forEach((r, ri) => {
      const col = r.pick != null ? colOf.get(r.pick) : undefined
      if (col != null) {
        votes[col] = (votes[col] ?? 0) + 1
        const row = selectionMatrix[col]
        if (row) row[ri] = 1
      }
    })
    const { coefficient, metric } = agreement({ mode: "pick", selectionMatrix })
    const { winner, clear } = topCandidate(ids, votes)
    return {
      winner,
      consensusReached: clear && coefficient >= config.threshold,
      coefficient,
      metric,
      aggregateMethod: "votes",
      scores: ids.map((cid, i) => ({ candidateId: cid, score: votes[i] ?? 0 })),
    }
  }

  // Ranked: Borda count for the winner; Krippendorff (ordinal) over the rank matrix for agreement.
  const rankMatrix: (number | null)[][] = ids.map(() => ratings.map(() => null as number | null))
  const borda = new Array<number>(N).fill(0)
  ratings.forEach((r, ri) => {
    r.ranking.forEach((cid, pos) => {
      const col = colOf.get(cid)
      if (col != null) {
        const row = rankMatrix[col]
        if (row) row[ri] = pos + 1 // 1 = best
        borda[col] = (borda[col] ?? 0) + (N - (pos + 1)) // best gets N-1 points
      }
    })
  })
  const { coefficient, metric } = agreement({ mode: "rank", rankMatrix })
  const { winner, clear } = topCandidate(ids, borda)
  return {
    winner,
    consensusReached: clear && coefficient >= config.threshold,
    coefficient,
    metric,
    aggregateMethod: "borda",
    scores: ids.map((cid, i) => ({ candidateId: cid, score: borda[i] ?? 0 })),
  }
}

/** Argmax with a strict-uniqueness check: a tie for the top is not a clear winner. */
function topCandidate(
  ids: ReadonlyArray<string>,
  scores: ReadonlyArray<number>,
): { winner: string | null; clear: boolean } {
  let best = Number.NEGATIVE_INFINITY
  let bestIdx = -1
  let tie = false
  scores.forEach((s, i) => {
    if (s > best) {
      best = s
      bestIdx = i
      tie = false
    } else if (s === best) {
      tie = true
    }
  })
  const winner = bestIdx >= 0 ? (ids[bestIdx] ?? null) : null
  return { winner, clear: bestIdx >= 0 && !tie }
}
