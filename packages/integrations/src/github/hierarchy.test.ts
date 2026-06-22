import type { IssueTracker, KnowledgeBase, Ticket } from "@eng/core"
import { describe, expect, it, vi } from "vitest"
import { ensureSeedEpicId, GitHubHierarchy } from "./hierarchy"

const DOC = JSON.stringify({
  mission: { title: "M", statement: "S" },
  goals: { "goal-1": { title: "G", description: "GD" } },
  epics: { "epic-1": { title: "E", goalId: "goal-1" } },
})

function knowledgeWith(read: () => Promise<string | null>): KnowledgeBase {
  return { read, write: vi.fn(async () => {}), list: vi.fn(async () => []) }
}

const ticket = (epicId: string): Ticket => ({
  id: "gh-5",
  epicId,
  title: "T",
  description: "",
  status: "in_review",
  stage: "review",
  assigneeRole: null,
  acceptanceCriteria: [],
  createdAt: "t",
  updatedAt: "t",
})

function trackerReturning(t: Ticket | null): IssueTracker {
  return { get: vi.fn(async () => t) } as unknown as IssueTracker
}

describe("GitHubHierarchy", () => {
  it("walks epic → goal → mission for a ticket", async () => {
    const trace = await new GitHubHierarchy(
      trackerReturning(ticket("epic-1")),
      knowledgeWith(async () => DOC),
    ).traceContext("gh-5")
    expect(trace).toContain("Mission: M — S")
    expect(trace).toContain("Goal: G — GD")
    expect(trace).toContain("Epic: E")
    expect(trace).toContain("Ticket: T")
  })

  it("falls back when the hierarchy doc is missing", async () => {
    const trace = await new GitHubHierarchy(
      trackerReturning(ticket("epic-1")),
      knowledgeWith(async () => null),
    ).traceContext("gh-5")
    expect(trace).toContain("no trace context")
  })
})

describe("ensureSeedEpicId", () => {
  it("returns the existing epic without writing when the doc exists", async () => {
    const k = knowledgeWith(async () => DOC)
    expect(await ensureSeedEpicId(k)).toBe("epic-1")
    expect(k.write).not.toHaveBeenCalled()
  })

  it("seeds a default doc and returns epic-1 when absent", async () => {
    const write = vi.fn(async () => {})
    const k: KnowledgeBase = { read: async () => null, write, list: async () => [] }
    expect(await ensureSeedEpicId(k)).toBe("epic-1")
    expect(write).toHaveBeenCalled()
  })
})
