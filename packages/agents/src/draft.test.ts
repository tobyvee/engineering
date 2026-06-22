import { describe, expect, it } from "vitest"
import { draft } from "./draft"

describe("draft", () => {
  it("short-circuits on an exhausted budget without touching a backend", async () => {
    const result = await draft({
      role: "pm",
      systemPrompt: "",
      goalContext: "",
      task: "Define requirements.",
      budgetCentsRemaining: 0,
    })
    expect(result.stoppedReason).toBe("budget_exhausted")
    expect(result.costCents).toBe(0)
    expect(result.content).toContain("skipped")
  })
})
