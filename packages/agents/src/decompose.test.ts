import { describe, expect, it } from "vitest"
import { parseTickets } from "./decompose"

describe("parseTickets", () => {
  it("parses a fenced JSON list of tickets", () => {
    const text =
      '```json\n{"tickets":[{"title":"Build login","description":"d","acceptanceCriteria":["a","b"],"assigneeRole":"staff_engineer"}]}\n```'
    expect(parseTickets(text)).toEqual([
      {
        title: "Build login",
        description: "d",
        acceptanceCriteria: ["a", "b"],
        assigneeRole: "staff_engineer",
      },
    ])
  })

  it("nulls an unknown assignee role and defaults missing fields", () => {
    const text = '{"tickets":[{"title":"X","assigneeRole":"wizard"}]}'
    expect(parseTickets(text)).toEqual([
      { title: "X", description: "", acceptanceCriteria: [], assigneeRole: null },
    ])
  })

  it("drops titleless and malformed entries", () => {
    const text =
      '{"tickets":[{"description":"no title"},{"title":"Keep","assigneeRole":"qa_test"}, null]}'
    expect(parseTickets(text)).toEqual([
      { title: "Keep", description: "", acceptanceCriteria: [], assigneeRole: "qa_test" },
    ])
  })

  it("returns an empty list on non-JSON or non-array output", () => {
    expect(parseTickets("just prose")).toEqual([])
    expect(parseTickets('{"tickets":"nope"}')).toEqual([])
  })
})
