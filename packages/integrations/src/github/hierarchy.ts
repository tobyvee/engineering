import type { Hierarchy } from "@eng/core"
import type { Octokit } from "octokit"

function issueNumber(id: string): number {
  return Number(id.replace(/^gh-/, ""))
}

function status(err: unknown): number | undefined {
  return (err as { status?: number })?.status
}

interface ParentIssue {
  number: number
  title: string
  body: string
}

/**
 * Hierarchy backed by **native GitHub sub-issues**. Mission/Goal/Epic are issues (labelled
 * `type:mission|goal|epic`) linked as parent→child; tickets are sub-issues of an epic.
 * `traceContext` walks the native parent chain — the GitHub-native model. (Sub-issue endpoints take
 * the issue's database `id`, not its number.)
 */
export class GitHubHierarchy implements Hierarchy {
  constructor(
    private readonly octokit: Octokit,
    private readonly repo: { owner: string; repo: string },
  ) {}

  async traceContext(ticketId: string): Promise<string> {
    const number = issueNumber(ticketId)
    const ticket = await this.issueTitle(number)
    if (ticket === null) return `Ticket ${ticketId} (no trace context found).`
    const epic = await this.parentOf(number)
    const goal = epic ? await this.parentOf(epic.number) : null
    const mission = goal ? await this.parentOf(goal.number) : null
    return [
      mission ? `Mission: ${mission.title} — ${mission.body}` : "Mission: (unknown)",
      goal ? `Goal: ${goal.title} — ${goal.body}` : "Goal: (unknown)",
      epic ? `Epic: ${epic.title}` : "Epic: (unknown)",
      `Ticket: ${ticket}`,
    ].join("\n")
  }

  /** Ensure mission→goal→epic issues exist (linked as sub-issues); return the epic issue number. */
  async ensureSeedEpicId(): Promise<string> {
    const { data } = await this.octokit.rest.issues.listForRepo({
      ...this.repo,
      labels: "type:epic",
      state: "all",
      per_page: 1,
    })
    const existing = data[0]
    if (existing) return String(existing.number)

    const mission = await this.create("Deliver the product", "Ship value to users.", "type:mission")
    const goal = await this.create("Bootstrap the unit", "Stand up delivery.", "type:goal")
    const epic = await this.create("Vertical slice", "First end-to-end flow.", "type:epic")
    await this.link(mission.number, goal.id)
    await this.link(goal.number, epic.id)
    return String(epic.number)
  }

  /** Link a ticket issue (database id) as a sub-issue of an epic (issue number). */
  async attachTicket(epicId: string, ticketIssueId: number): Promise<void> {
    await this.link(Number(epicId), ticketIssueId)
  }

  private async create(
    title: string,
    body: string,
    label: string,
  ): Promise<{ number: number; id: number }> {
    const { data } = await this.octokit.rest.issues.create({
      ...this.repo,
      title,
      body,
      labels: [label],
    })
    return { number: data.number, id: data.id }
  }

  private async link(parentNumber: number, childId: number): Promise<void> {
    await this.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
      ...this.repo,
      issue_number: parentNumber,
      sub_issue_id: childId,
    })
  }

  private async issueTitle(number: number): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.issues.get({ ...this.repo, issue_number: number })
      return data.title
    } catch (err) {
      if (status(err) === 404) return null
      throw err
    }
  }

  private async parentOf(number: number): Promise<ParentIssue | null> {
    try {
      const { data } = await this.octokit.request(
        "GET /repos/{owner}/{repo}/issues/{issue_number}/parent",
        { ...this.repo, issue_number: number },
      )
      return { number: data.number, title: data.title, body: data.body ?? "" }
    } catch (err) {
      if (status(err) === 404) return null
      throw err
    }
  }
}
