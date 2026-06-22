import { describe, expect, it } from "vitest"
import { ClaudeWorker, resolveMode } from "./claude-worker"
import { affordableMaxTokens, costCentsFromUsage } from "./pricing"
import { buildSystemPrompt } from "./prompt"

describe("pricing", () => {
  it("computes Opus 4.8 cost from token usage", () => {
    expect(
      costCentsFromUsage("claude-opus-4-8", { input_tokens: 1_000_000, output_tokens: 0 }),
    ).toBe(500)
    expect(
      costCentsFromUsage("claude-opus-4-8", { input_tokens: 0, output_tokens: 1_000_000 }),
    ).toBe(2500)
  })

  it("caps affordable output tokens by remaining budget", () => {
    // 2.5¢ ÷ (2500¢ / 1M) = 1000 output tokens
    expect(affordableMaxTokens("claude-opus-4-8", 2.5, 16000)).toBe(1000)
    expect(affordableMaxTokens("claude-opus-4-8", 1_000_000, 16000)).toBe(16000)
  })
})

describe("buildSystemPrompt", () => {
  it("injects the role prompt, goal context, and tools", () => {
    const prompt = buildSystemPrompt({
      role: "pm",
      systemPrompt: "You are the PM.",
      tools: ["tracker", "docs"],
      goalContext: "Mission: ship value",
      task: "draft the roadmap",
      budgetCentsRemaining: 100,
    })
    expect(prompt).toContain("You are the PM.")
    expect(prompt).toContain("Mission: ship value")
    expect(prompt).toContain("tracker")
  })
})

describe("resolveMode", () => {
  it("defaults to api and honors an explicit cli", () => {
    expect(resolveMode()).toBe("api")
    expect(resolveMode("cli")).toBe("cli")
  })
})

describe("ClaudeWorker budget guard", () => {
  it("short-circuits with budget_exhausted without touching a backend", async () => {
    const worker = new ClaudeWorker({ mode: "api" })
    const result = await worker.run({
      role: "pm",
      systemPrompt: "",
      tools: [],
      goalContext: "",
      task: "x",
      budgetCentsRemaining: 0,
    })
    expect(result.stoppedReason).toBe("budget_exhausted")
    expect(result.costCents).toBe(0)
  })
})
