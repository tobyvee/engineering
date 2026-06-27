import { describe, expect, it } from "vitest"
import { traceToRoot } from "./decision"
import { Decision } from "./schema"

/** Build a minimal valid Decision for graph tests. */
function dec(id: string, parents: string[], root = "epic-1"): Decision {
  return {
    id,
    rootRequestId: root,
    parentDecisionIds: parents,
    missionId: null,
    goalId: null,
    epicId: root,
    ticketId: null,
    actor: "system",
    stage: "implementation",
    statement: `decision ${id}`,
    rationale: "",
    alternatives: [],
    inputs: [],
    outputs: [],
    confidence: null,
    costCents: null,
    auditEventId: null,
    at: "2026-06-27T00:00:00.000Z",
  }
}

describe("Decision schema", () => {
  it("accepts a well-formed decision with alternatives", () => {
    const parsed = Decision.parse({
      ...dec("d1", []),
      alternatives: [{ option: "use SQLite", rejectedBecause: "needs network durability" }],
      confidence: 0.7,
    })
    expect(parsed.alternatives[0]?.option).toBe("use SQLite")
    expect(parsed.confidence).toBe(0.7)
  })

  it("rejects confidence outside [0,1]", () => {
    expect(() => Decision.parse({ ...dec("d1", []), confidence: 1.5 })).toThrow()
  })
})

describe("traceToRoot", () => {
  const byId = new Map(
    [
      dec("root", []),
      dec("a", ["root"]),
      dec("b", ["a"]),
      dec("c", ["a"]),
      dec("d", ["b", "c"]), // DAG: two parents
    ].map((d) => [d.id, d]),
  )

  it("walks a linear chain from a node up to the root", () => {
    const ids = traceToRoot("b", byId).map((d) => d.id)
    expect(ids).toEqual(["b", "a", "root"])
  })

  it("follows all parents of a DAG node, deduplicated, ending at the root", () => {
    const ids = traceToRoot("d", byId).map((d) => d.id)
    expect(ids[0]).toBe("d")
    expect(ids).toContain("b")
    expect(ids).toContain("c")
    expect(ids.filter((id) => id === "a")).toHaveLength(1) // shared ancestor not duplicated
    expect(ids.filter((id) => id === "root")).toHaveLength(1)
    expect(ids).toHaveLength(5)
  })

  it("returns the root itself as a single-node trace", () => {
    expect(traceToRoot("root", byId).map((d) => d.id)).toEqual(["root"])
  })

  it("returns empty for an unknown id", () => {
    expect(traceToRoot("nope", byId)).toEqual([])
  })
})
