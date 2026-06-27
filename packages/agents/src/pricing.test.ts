import { describe, expect, it } from "vitest"
import { estimateRunCostCents } from "./pricing"

describe("estimateRunCostCents", () => {
  it("returns a positive hold that grows with budget, up to the output-cap cost", () => {
    const small = estimateRunCostCents(5, "claude-opus-4-8")
    const large = estimateRunCostCents(1_000_000, "claude-opus-4-8")
    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThanOrEqual(small)
    // 16000 output tokens × 2500¢/1M ≈ 40¢ worst case for opus-4-8.
    expect(large).toBeLessThanOrEqual(40)
  })
})
