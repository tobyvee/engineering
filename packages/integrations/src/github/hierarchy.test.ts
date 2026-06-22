import type { Octokit } from "octokit"
import { describe, expect, it, vi } from "vitest"
import { GitHubHierarchy } from "./hierarchy"

const repo = { owner: "acme", repo: "widgets" }

function hierarchyWith(
  rest: Record<string, unknown>,
  request: ReturnType<typeof vi.fn> = vi.fn(),
): GitHubHierarchy {
  return new GitHubHierarchy({ rest, request } as unknown as Octokit, repo)
}

function notFound(): Error {
  return Object.assign(new Error("not found"), { status: 404 })
}

describe("GitHubHierarchy.traceContext", () => {
  it("walks the native parent chain ticket → epic → goal → mission", async () => {
    const get = vi.fn(async () => ({ data: { title: "T" } }))
    const parents: Record<number, { number: number; title: string; body: string }> = {
      5: { number: 3, title: "E", body: "" },
      3: { number: 2, title: "G", body: "GD" },
      2: { number: 1, title: "M", body: "MS" },
    }
    const request = vi.fn(async (_route: string, params: { issue_number: number }) => {
      const parent = parents[params.issue_number]
      if (!parent) throw notFound()
      return { data: parent }
    })

    const trace = await hierarchyWith({ issues: { get } }, request).traceContext("gh-5")

    expect(trace).toContain("Mission: M — MS")
    expect(trace).toContain("Goal: G — GD")
    expect(trace).toContain("Epic: E")
    expect(trace).toContain("Ticket: T")
  })

  it("falls back when the ticket issue is missing", async () => {
    const get = vi.fn(async () => {
      throw notFound()
    })
    const trace = await hierarchyWith({ issues: { get } }).traceContext("gh-9")
    expect(trace).toContain("no trace context")
  })
})

describe("GitHubHierarchy.ensureSeedEpicId", () => {
  it("returns the existing epic without creating issues", async () => {
    const listForRepo = vi.fn(async () => ({ data: [{ number: 3 }] }))
    const create = vi.fn()
    const id = await hierarchyWith({ issues: { listForRepo, create } }).ensureSeedEpicId()
    expect(id).toBe("3")
    expect(create).not.toHaveBeenCalled()
  })

  it("creates mission→goal→epic and links them when absent", async () => {
    const listForRepo = vi.fn(async () => ({ data: [] }))
    let n = 10
    const create = vi.fn(async () => {
      n += 1
      return { data: { number: n, id: n * 1000 } }
    })
    const request = vi.fn(async () => ({ data: {} }))

    const id = await hierarchyWith({ issues: { listForRepo, create } }, request).ensureSeedEpicId()

    expect(id).toBe("13") // mission=11, goal=12, epic=13
    expect(create).toHaveBeenCalledTimes(3)
    expect(request).toHaveBeenCalledTimes(2) // mission→goal, goal→epic sub-issue links
  })
})

describe("GitHubHierarchy.attachTicket", () => {
  it("links a ticket id under an epic number via the sub-issues endpoint", async () => {
    const request = vi.fn(async () => ({ data: {} }))
    await hierarchyWith({}, request).attachTicket("3", 99000)
    expect(request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      expect.objectContaining({ issue_number: 3, sub_issue_id: 99000 }),
    )
  })
})

describe("GitHubHierarchy authoring", () => {
  it("createGoal seeds the mission if absent then links the goal under it", async () => {
    const listForRepo = vi.fn(async () => ({ data: [] }))
    let n = 20
    const create = vi.fn(async () => {
      n += 1
      return { data: { number: n, id: n * 1000 } }
    })
    const request = vi.fn(async () => ({ data: {} }))

    const goal = await hierarchyWith({ issues: { listForRepo, create } }, request).createGoal({
      title: "Q3 Initiative",
    })

    expect(goal).toEqual({ id: "22", title: "Q3 Initiative" }) // mission=21, goal=22
    expect(create).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      expect.objectContaining({ issue_number: 21, sub_issue_id: 22000 }),
    )
  })

  it("createEpic links the new epic under the given goal", async () => {
    let n = 30
    const create = vi.fn(async () => {
      n += 1
      return { data: { number: n, id: n * 1000 } }
    })
    const request = vi.fn(async () => ({ data: {} }))

    const epic = await hierarchyWith({ issues: { create } }, request).createEpic({
      title: "Epic B",
      goalId: "7",
    })

    expect(epic).toEqual({ id: "31", title: "Epic B" })
    expect(create).toHaveBeenCalledTimes(1) // goal already chosen — no goal/mission seeding
    expect(request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      expect.objectContaining({ issue_number: 7, sub_issue_id: 31000 }),
    )
  })

  it("listEpics(goalId) reads the goal's sub-issues", async () => {
    const request = vi.fn(async () => ({
      data: [
        { number: 5, title: "Epic A" },
        { number: 6, title: "Epic B" },
      ],
    }))

    const epics = await hierarchyWith({}, request).listEpics("7")

    expect(epics).toEqual([
      { id: "5", title: "Epic A" },
      { id: "6", title: "Epic B" },
    ])
    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      expect.objectContaining({ issue_number: 7 }),
    )
  })

  it("listEpics() and listGoals() list issues by type label", async () => {
    const listForRepo = vi.fn(async () => ({ data: [{ number: 9, title: "X" }] }))
    const h = hierarchyWith({ issues: { listForRepo } })

    expect(await h.listEpics()).toEqual([{ id: "9", title: "X" }])
    expect(listForRepo).toHaveBeenCalledWith(expect.objectContaining({ labels: "type:epic" }))
    expect(await h.listGoals()).toEqual([{ id: "9", title: "X" }])
    expect(listForRepo).toHaveBeenCalledWith(expect.objectContaining({ labels: "type:goal" }))
  })
})
