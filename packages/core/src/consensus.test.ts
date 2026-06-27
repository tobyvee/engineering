import { describe, expect, it } from "vitest"
import { type ConsensusConfig, DEFAULT_CONSENSUS_CONFIG, decide, type Rating } from "./consensus"

const cands = [{ id: "a" }, { id: "b" }, { id: "c" }]

const pickConfig: ConsensusConfig = {
  ...DEFAULT_CONSENSUS_CONFIG,
  inputMode: "pick",
  threshold: 0.6,
  advisory: true,
}
const rankConfig: ConsensusConfig = {
  ...DEFAULT_CONSENSUS_CONFIG,
  inputMode: "rank",
  threshold: 0.6,
}

const pick = (role: Rating["raterRole"], c: string): Rating => ({
  raterRole: role,
  pick: c,
  ranking: [],
  rationale: "",
  costCents: null,
})
const rank = (role: Rating["raterRole"], order: string[]): Rating => ({
  raterRole: role,
  pick: null,
  ranking: order,
  rationale: "",
  costCents: null,
})

describe("decide — single-pick", () => {
  it("reaches consensus when all raters pick the same candidate", () => {
    const out = decide(
      cands,
      [pick("lead_architect", "b"), pick("lead_system_design", "b"), pick("lead_engineer", "b")],
      pickConfig,
    )
    expect(out.winner).toBe("b")
    expect(out.consensusReached).toBe(true)
    expect(out.aggregateMethod).toBe("votes")
    expect(out.coefficient).toBe(1)
  })

  it("does NOT reach consensus when raters split evenly (no clear winner, low agreement)", () => {
    const out = decide(
      cands,
      [pick("lead_architect", "a"), pick("lead_system_design", "b"), pick("lead_engineer", "c")],
      pickConfig,
    )
    expect(out.consensusReached).toBe(false) // three-way tie → tie-breaker
  })

  it("has a clear plurality winner but withholds consensus when agreement is below threshold", () => {
    const out = decide(
      cands,
      [pick("lead_architect", "a"), pick("lead_system_design", "a"), pick("lead_engineer", "b")],
      pickConfig,
    )
    expect(out.winner).toBe("a") // 2 vs 1 — clear plurality
    expect(out.consensusReached).toBe(false) // but agreement < 0.6 → tie-breaker
  })
})

describe("decide — ranked (Borda + Kendall/Krippendorff)", () => {
  it("reaches consensus when all raters rank identically", () => {
    const out = decide(
      cands,
      [
        rank("lead_architect", ["a", "b", "c"]),
        rank("lead_system_design", ["a", "b", "c"]),
        rank("lead_engineer", ["a", "b", "c"]),
      ],
      rankConfig,
    )
    expect(out.winner).toBe("a")
    expect(out.consensusReached).toBe(true)
    expect(out.aggregateMethod).toBe("borda")
    expect(out.coefficient).toBeGreaterThanOrEqual(0.6)
  })

  it("picks the Borda winner but routes to tie-break when rankings disagree", () => {
    const out = decide(
      cands,
      [
        rank("lead_architect", ["a", "b", "c"]),
        rank("lead_system_design", ["c", "b", "a"]),
        rank("lead_engineer", ["b", "c", "a"]),
      ],
      rankConfig,
    )
    expect(out.consensusReached).toBe(false)
  })

  it("respects a lower threshold (advisory tuning)", () => {
    const out = decide(
      cands,
      [
        rank("lead_architect", ["a", "b", "c"]),
        rank("lead_system_design", ["a", "c", "b"]),
        rank("lead_engineer", ["a", "b", "c"]),
      ],
      { ...rankConfig, threshold: -1 },
    )
    expect(out.winner).toBe("a")
    expect(out.consensusReached).toBe(true) // clear winner + threshold trivially met
  })
})
