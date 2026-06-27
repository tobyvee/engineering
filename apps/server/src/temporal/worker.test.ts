import { describe, expect, it } from "vitest"
import { resolveTemporalAddress } from "./worker"

describe("resolveTemporalAddress", () => {
  it("honors TEMPORAL_ADDRESS so the worker reaches Temporal across containers", () => {
    expect(resolveTemporalAddress({ TEMPORAL_ADDRESS: "temporal:7233" })).toBe("temporal:7233")
  })

  it("defaults to localhost:7233 when unset", () => {
    expect(resolveTemporalAddress({})).toBe("localhost:7233")
  })
})
