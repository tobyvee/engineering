import { describe, expect, it } from "vitest"
import { parseDirections, parseRating } from "./consensus"

describe("parseDirections", () => {
  it("extracts candidates and bounds them to max", () => {
    const text = JSON.stringify({
      candidates: [
        { title: "A", summary: "sa", tradeoffs: ["t1"] },
        { title: "B", summary: "sb", tradeoffs: [] },
        { title: "C", summary: "sc", tradeoffs: ["t2", "t3"] },
      ],
    })
    const out = parseDirections(text, 2)
    expect(out).toHaveLength(2)
    expect(out[0]?.title).toBe("A")
    expect(out[0]?.tradeoffs).toEqual(["t1"])
  })

  it("tolerates a fenced JSON block and missing tradeoffs", () => {
    const text = '```json\n{"candidates":[{"title":"X","summary":"y"}]}\n```'
    const out = parseDirections(text)
    expect(out).toEqual([{ title: "X", summary: "y", tradeoffs: [] }])
  })

  it("returns [] on unparseable output", () => {
    expect(parseDirections("no json here")).toEqual([])
  })
})

describe("parseRating", () => {
  const ids = ["a", "b", "c"]

  it("parses a single pick constrained to known ids", () => {
    const r = parseRating('{"pick":"b","rationale":"clearest"}', "lead_architect", ids, "pick", 1.5)
    expect(r.pick).toBe("b")
    expect(r.ranking).toEqual([])
    expect(r.rationale).toBe("clearest")
    expect(r.costCents).toBe(1.5)
    expect(r.raterRole).toBe("lead_architect")
  })

  it("drops a pick that isn't a known candidate (abstention)", () => {
    const r = parseRating('{"pick":"z","rationale":"?"}', "lead_engineer", ids, "pick", 0)
    expect(r.pick).toBeNull()
  })

  it("parses a ranking, filtering unknowns and de-duplicating", () => {
    const r = parseRating(
      '{"ranking":["c","a","c","z","b"],"rationale":"r"}',
      "lead_system_design",
      ids,
      "rank",
      2,
    )
    expect(r.ranking).toEqual(["c", "a", "b"])
    expect(r.pick).toBeNull()
  })

  it("falls back to an abstention on unparseable output", () => {
    const r = parseRating("garbage", "lead_architect", ids, "pick", 0)
    expect(r.pick).toBeNull()
    expect(r.ranking).toEqual([])
  })
})
