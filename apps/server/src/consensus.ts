import { type ConsensusConfig, DEFAULT_CONSENSUS_CONFIG } from "@eng/core"

/**
 * Per-unit consensus configuration (ENG-016), resolved from env so the rubric / mode / threshold /
 * tie-breaker are config, not code (invariant #6). Phase 1 ships **advisory** (record the round + score
 * but don't block) and behind `CONSENSUS_ENABLED`.
 */
export function consensusEnabled(): boolean {
  return process.env.CONSENSUS_ENABLED === "true"
}

export function consensusConfigFromEnv(): ConsensusConfig {
  return {
    ...DEFAULT_CONSENSUS_CONFIG,
    inputMode:
      process.env.CONSENSUS_INPUT_MODE === "pick"
        ? "pick"
        : process.env.CONSENSUS_INPUT_MODE === "rank"
          ? "rank"
          : DEFAULT_CONSENSUS_CONFIG.inputMode,
    threshold: process.env.CONSENSUS_THRESHOLD
      ? Number(process.env.CONSENSUS_THRESHOLD)
      : DEFAULT_CONSENSUS_CONFIG.threshold,
    // Advisory by default (Phase 1); set CONSENSUS_ADVISORY=false to promote to a real gate (Phase 2).
    advisory: process.env.CONSENSUS_ADVISORY
      ? process.env.CONSENSUS_ADVISORY !== "false"
      : DEFAULT_CONSENSUS_CONFIG.advisory,
    tieBreaker: process.env.CONSENSUS_TIEBREAKER === "casting_vote" ? "casting_vote" : "human",
  }
}
