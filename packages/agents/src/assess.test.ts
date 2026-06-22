import { describe, expect, it } from "vitest"
import { parseVerdict } from "./assess"

describe("parseVerdict", () => {
  it("reads a passing verdict", () => {
    expect(parseVerdict('{"passed":true,"summary":"all criteria met"}')).toEqual({
      passed: true,
      summary: "all criteria met",
    })
  })

  it("reads a failing verdict", () => {
    expect(parseVerdict('Verdict: {"passed":false,"summary":"missing tests"}')).toEqual({
      passed: false,
      summary: "missing tests",
    })
  })

  it("defaults to not-passed when the field is absent or output is non-JSON", () => {
    expect(parseVerdict('{"summary":"unclear"}').passed).toBe(false)
    expect(parseVerdict("just prose").passed).toBe(false)
  })
})
