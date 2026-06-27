import { describe, expect, it } from "vitest"
import { canReserve, periodExpired, remainingCents, withinBudget } from "./budget"

const budget = (limitCents: number, spentCents: number) =>
  ({ scope: "pm", limitCents, spentCents }) as const

describe("periodExpired", () => {
  it("is false within the same calendar month (UTC)", () => {
    expect(periodExpired("2026-06-01T00:00:00Z", new Date("2026-06-28T23:00:00Z"))).toBe(false)
  })
  it("is true once the month rolls over", () => {
    expect(periodExpired("2026-06-28T00:00:00Z", new Date("2026-07-01T00:00:00Z"))).toBe(true)
  })
  it("is true across a year boundary", () => {
    expect(periodExpired("2026-12-15T00:00:00Z", new Date("2027-01-02T00:00:00Z"))).toBe(true)
  })
})

describe("canReserve", () => {
  it("allows a reservation that fits", () => {
    expect(canReserve(budget(1000, 200), 800)).toBe(true)
  })
  it("rejects a reservation that would exceed the limit", () => {
    expect(canReserve(budget(1000, 900), 200)).toBe(false)
  })
  it("allows exactly hitting the limit", () => {
    expect(canReserve(budget(1000, 900), 100)).toBe(true)
  })
})

describe("remainingCents / withinBudget", () => {
  it("clamps remaining at zero and flags exhaustion", () => {
    expect(remainingCents(budget(1000, 1200))).toBe(0)
    expect(withinBudget(budget(1000, 1000))).toBe(false)
    expect(withinBudget(budget(1000, 999))).toBe(true)
  })
})
