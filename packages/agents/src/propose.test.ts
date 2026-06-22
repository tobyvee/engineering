import { describe, expect, it } from "vitest"
import { parseProposal } from "./propose"

describe("parseProposal", () => {
  it("parses a fenced JSON proposal", () => {
    const text = '```json\n{"summary":"add a","files":[{"path":"a.ts","content":"x"}]}\n```'
    expect(parseProposal(text)).toEqual({
      summary: "add a",
      files: [{ path: "a.ts", content: "x" }],
    })
  })

  it("parses bare JSON with surrounding prose", () => {
    const text = 'Here you go:\n{"summary":"s","files":[{"path":"b.ts","content":"y"}]}\nDone.'
    expect(parseProposal(text)).toEqual({ summary: "s", files: [{ path: "b.ts", content: "y" }] })
  })

  it("drops malformed file entries", () => {
    const text = '{"summary":"s","files":[{"path":"a"},{"path":"b","content":"ok"}]}'
    expect(parseProposal(text)).toEqual({ summary: "s", files: [{ path: "b", content: "ok" }] })
  })

  it("falls back to empty files on non-JSON output", () => {
    expect(parseProposal("just prose, no json")).toEqual({
      summary: "just prose, no json",
      files: [],
    })
  })
})
