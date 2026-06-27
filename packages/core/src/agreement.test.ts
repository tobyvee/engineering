import { describe, expect, it } from "vitest"
import { agreement, fleissKappa, kendallW, krippendorffAlpha } from "./agreement"

describe("krippendorffAlpha", () => {
  it("is 1 for perfect agreement (all raters identical)", () => {
    // 3 units (candidates) × 3 raters, everyone selects candidate 0
    const m = [
      [1, 1, 1],
      [0, 0, 0],
      [0, 0, 0],
    ]
    expect(krippendorffAlpha(m, "nominal")).toBe(1)
  })

  it("is 1 (degenerate-safe) when there is no variation at all", () => {
    expect(krippendorffAlpha([[5, 5, 5]], "nominal")).toBe(1)
    expect(krippendorffAlpha([[0, 0, 0]], "ordinal")).toBe(1)
  })

  it("goes negative for maximal disagreement (everyone picks a different option)", () => {
    const m = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    expect(krippendorffAlpha(m, "nominal")).toBeLessThan(0)
  })

  it("is between full and none for partial agreement (2 of 3 agree)", () => {
    const m = [
      [1, 1, 0],
      [0, 0, 1],
      [0, 0, 0],
    ]
    const a = krippendorffAlpha(m, "nominal")
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(1)
  })

  it("handles missing values (null cells) without NaN", () => {
    const a = krippendorffAlpha(
      [
        [1, 1, null],
        [0, null, 0],
      ],
      "nominal",
    )
    expect(Number.isNaN(a)).toBe(false)
  })
})

describe("fleissKappa (single-pick)", () => {
  it("is 1 when all raters pick the same candidate", () => {
    expect(fleissKappa([0, 0, 0], 3)).toBe(1)
  })

  it("is negative when all three raters pick different candidates", () => {
    expect(fleissKappa([0, 1, 2], 3)).toBeCloseTo(-0.5, 5)
  })

  it("is degenerate-safe for <2 raters or <2 candidates", () => {
    expect(fleissKappa([0], 3)).toBe(1)
    expect(fleissKappa([0, 0], 1)).toBe(1)
  })
})

describe("kendallW (ranked)", () => {
  it("is 1 when all raters give the identical ranking", () => {
    const w = kendallW([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ])
    expect(w).toBeCloseTo(1, 5)
  })

  it("is ~0 for perfectly opposed rankings (two raters)", () => {
    const w = kendallW([
      [1, 2, 3],
      [3, 2, 1],
    ])
    expect(w).toBeCloseTo(0, 5)
  })

  it("is between for partial concordance", () => {
    const w = kendallW([
      [1, 2, 3],
      [1, 3, 2],
    ])
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThan(1)
  })

  it("is degenerate-safe for <2 items", () => {
    expect(kendallW([[1], [1]])).toBe(1)
  })
})

describe("agreement (primary = Krippendorff)", () => {
  it("labels the metric and computes from a selection matrix (pick)", () => {
    const res = agreement({
      mode: "pick",
      selectionMatrix: [
        [1, 1, 1],
        [0, 0, 0],
      ],
    })
    expect(res.metric).toBe("krippendorff_alpha")
    expect(res.coefficient).toBe(1)
  })

  it("computes from a rank matrix (rank, ordinal)", () => {
    const res = agreement({
      mode: "rank",
      rankMatrix: [
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
      ],
    })
    expect(res.coefficient).toBe(1)
  })
})
