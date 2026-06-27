import { describe, expect, it } from "vitest"
import { supportsAdaptiveThinking } from "./prompt"

describe("supportsAdaptiveThinking", () => {
  it("is true for the adaptive-thinking family (Opus 4.6+/Sonnet 4.6/Fable)", () => {
    expect(supportsAdaptiveThinking("claude-opus-4-8")).toBe(true)
    expect(supportsAdaptiveThinking("claude-sonnet-4-6")).toBe(true)
    expect(supportsAdaptiveThinking("claude-fable-5")).toBe(true)
  })

  it("is false for models that reject adaptive thinking (Haiku 4.5, older)", () => {
    expect(supportsAdaptiveThinking("claude-haiku-4-5")).toBe(false)
    expect(supportsAdaptiveThinking("claude-sonnet-4-5")).toBe(false)
  })
})
