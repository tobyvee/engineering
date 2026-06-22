import type { Hierarchy, HierarchyNode } from "@eng/core"
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
 * `type:mission|goal|epic`) linked as parent→child; tickets are sub-issues of an epic. `traceContext`
 * walks the native parent chain, and goals/epics can be authored so work decomposes under multiple
 * epics. (Sub-issue endpoints take the issue's database `id`, not its number.)
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

  async listGoals(): Promise<HierarchyNode[]> {
    return this.byLabel("type:goal")
  }

  async createGoal(input: { title: string; description?: string }): Promise<HierarchyNode> {
    const missionNumber = await this.ensureMission()
    const goal = await this.create(input.title, input.description ?? "", "type:goal")
    await this.link(missionNumber, goal.id)
    return { id: String(goal.number), title: input.title }
  }

  async listEpics(goalId?: string): Promise<HierarchyNode[]> {
    if (goalId) return this.subIssues(Number(goalId))
    return this.byLabel("type:epic")
  }

  async createEpic(input: {
    title: string
    description?: string
    goalId?: string
  }): Promise<HierarchyNode> {
    const goalNumber = input.goalId ? Number(input.goalId) : await this.ensureDefaultGoal()
    const epic = await this.create(input.title, input.description ?? "", "type:epic")
    await this.link(goalNumber, epic.id)
    return { id: String(epic.number), title: input.title }
  }

  /** Ensure mission→goal→epic issues exist (linked as sub-issues); return the epic issue number. */
  async ensureSeedEpicId(): Promise<string> {
    const existing = (await this.byLabel("type:epic"))[0]
    if (existing) return existing.id
    const goalNumber = await this.ensureDefaultGoal()
    const epic = await this.create("Vertical slice", "First end-to-end flow.", "type:epic")
    await this.link(goalNumber, epic.id)
    return String(epic.number)
  }

  /** Link a ticket issue (database id) as a sub-issue of an epic (issue number). */
  async attachTicket(epicId: string, ticketIssueId: number): Promise<void> {
    await this.link(Number(epicId), ticketIssueId)
  }

  private async ensureMission(): Promise<number> {
    const existing = (await this.byLabel("type:mission"))[0]
    if (existing) return Number(existing.id)
    const mission = await this.create("Deliver the product", "Ship value to users.", "type:mission")
    return mission.number
  }

  private async ensureDefaultGoal(): Promise<number> {
    const existing = (await this.byLabel("type:goal"))[0]
    if (existing) return Number(existing.id)
    const missionNumber = await this.ensureMission()
    const goal = await this.create("Bootstrap the unit", "Stand up delivery.", "type:goal")
    await this.link(missionNumber, goal.id)
    return goal.number
  }

  private async byLabel(label: string): Promise<HierarchyNode[]> {
    const { data } = await this.octokit.rest.issues.listForRepo({
      ...this.repo,
      labels: label,
      state: "all",
      per_page: 100,
    })
    return data.map((i) => ({ id: String(i.number), title: i.title }))
  }

  private async subIssues(parentNumber: number): Promise<HierarchyNode[]> {
    const { data } = await this.octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      { ...this.repo, issue_number: parentNumber },
    )
    return (data as { number: number; title: string }[]).map((i) => ({
      id: String(i.number),
      title: i.title,
    }))
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
