import type { KnowledgeBase, NewTicket } from "@eng/core"
import type { Octokit } from "octokit"
import { describe, expect, it, vi } from "vitest"
import { GitHubIssueTracker } from "./issues"

const repo = { owner: "acme", repo: "widgets" }
const noopKnowledge: KnowledgeBase = {
  read: async () => null,
  write: async () => {},
  list: async () => [],
}
function trackerWith(issues: Record<string, unknown>): GitHubIssueTracker {
  return new GitHubIssueTracker({ rest: { issues } } as unknown as Octokit, repo, noopKnowledge)
}

const newTicket: NewTicket = {
  epicId: "epic-1",
  title: "Build X",
  description: "do X",
  status: "backlog",
  stage: "implementation",
  assigneeRole: "staff_engineer",
  acceptanceCriteria: ["a", "b"],
}

describe("GitHubIssueTracker", () => {
  it("creates an issue with metadata + labels and maps it back", async () => {
    const create = vi.fn().mockImplementation(async (args) => ({
      data: { number: 12, title: args.title, body: args.body, created_at: "t0", updated_at: "t0" },
    }))

    const ticket = await trackerWith({ create }).createTicket(newTicket)

    expect(ticket).toEqual({
      id: "gh-12",
      epicId: "epic-1",
      title: "Build X",
      description: "do X",
      status: "backlog",
      stage: "implementation",
      assigneeRole: "staff_engineer",
      acceptanceCriteria: ["a", "b"],
      createdAt: "t0",
      updatedAt: "t0",
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: ["status:backlog", "stage:implementation"],
        body: expect.stringContaining("eng-ticket"),
      }),
    )
  })

  it("round-trips domain fields through the body and filters out PRs on list", async () => {
    const meta = {
      epicId: "epic-1",
      status: "in_review",
      stage: "review",
      assigneeRole: "qa_test",
      acceptanceCriteria: ["a"],
    }
    const listForRepo = vi.fn().mockResolvedValue({
      data: [
        {
          number: 5,
          title: "Build X",
          body: `do X\n\n<!-- eng-ticket: ${JSON.stringify(meta)} -->`,
          created_at: "t",
          updated_at: "t",
        },
        { number: 6, title: "a PR", body: "", created_at: "t", updated_at: "t", pull_request: {} },
      ],
    })

    const tickets = await trackerWith({ listForRepo }).list()

    expect(tickets).toHaveLength(1)
    expect(tickets[0]).toMatchObject({
      id: "gh-5",
      epicId: "epic-1",
      status: "in_review",
      stage: "review",
      assigneeRole: "qa_test",
      description: "do X",
    })
  })

  it("transition closes on done and rewrites the status label", async () => {
    const meta = {
      epicId: "e",
      status: "in_review",
      stage: "review",
      assigneeRole: null,
      acceptanceCriteria: [],
    }
    const get = vi.fn().mockResolvedValue({
      data: { number: 5, body: `do X\n\n<!-- eng-ticket: ${JSON.stringify(meta)} -->` },
    })
    const update = vi.fn().mockImplementation(async (a) => ({
      data: { number: 5, title: "Build X", body: a.body, created_at: "t", updated_at: "t" },
    }))

    await trackerWith({ get, update }).transition("gh-5", "done")

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 5,
        state: "closed",
        labels: ["status:done", "stage:review"],
      }),
    )
  })
})
