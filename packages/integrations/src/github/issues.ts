import type {
  IssueTracker,
  LifecycleStage,
  NewTicket,
  RoleId,
  Ticket,
  TicketStatus,
} from "@eng/core"
import type { Octokit } from "octokit"
import type { GitHubHierarchy } from "./hierarchy"

/** Our domain fields that GitHub Issues don't model natively are round-tripped in a metadata block. */
interface TicketMeta {
  epicId: string
  status: TicketStatus
  stage: LifecycleStage
  assigneeRole: RoleId | null
  acceptanceCriteria: string[]
}

const META_RE = /<!-- eng-ticket:\s*([\s\S]*?)-->/

function fallbackMeta(): TicketMeta {
  return {
    epicId: "",
    status: "backlog",
    stage: "implementation",
    assigneeRole: null,
    acceptanceCriteria: [],
  }
}

function parseMeta(body: string): TicketMeta {
  const match = body.match(META_RE)
  if (!match?.[1]) return fallbackMeta()
  try {
    const obj = JSON.parse(match[1].trim()) as Partial<TicketMeta>
    return {
      epicId: typeof obj.epicId === "string" ? obj.epicId : "",
      status: (obj.status as TicketStatus) ?? "backlog",
      stage: (obj.stage as LifecycleStage) ?? "implementation",
      assigneeRole: (obj.assigneeRole as RoleId | null) ?? null,
      acceptanceCriteria: Array.isArray(obj.acceptanceCriteria) ? obj.acceptanceCriteria : [],
    }
  } catch {
    return fallbackMeta()
  }
}

function stripMeta(body: string): string {
  return body.replace(META_RE, "").trim()
}

function renderBody(description: string, meta: TicketMeta): string {
  return `${description.trim()}\n\n<!-- eng-ticket: ${JSON.stringify(meta)} -->`
}

function issueNumber(id: string): number {
  return Number(id.replace(/^gh-/, ""))
}

interface GitHubIssue {
  number: number
  title: string
  body?: string | null
  created_at: string
  updated_at: string
  pull_request?: unknown
}

function toTicket(issue: GitHubIssue): Ticket {
  const body = issue.body ?? ""
  const meta = parseMeta(body)
  return {
    id: `gh-${issue.number}`,
    epicId: meta.epicId,
    title: issue.title,
    description: stripMeta(body),
    status: meta.status,
    stage: meta.stage,
    assigneeRole: meta.assigneeRole,
    acceptanceCriteria: meta.acceptanceCriteria,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  }
}

/** IssueTracker backed by GitHub Issues. Status/stage are mirrored to labels; the full ticket is
 *  round-tripped via a metadata comment so `list` reconstructs domain fields faithfully. */
export class GitHubIssueTracker implements IssueTracker {
  constructor(
    private readonly octokit: Octokit,
    private readonly repo: { owner: string; repo: string },
    private readonly hierarchy: GitHubHierarchy,
  ) {}

  async createTicket(input: NewTicket): Promise<Ticket> {
    const epicId = input.epicId || (await this.hierarchy.ensureSeedEpicId())
    const meta: TicketMeta = {
      epicId,
      status: input.status,
      stage: input.stage,
      assigneeRole: input.assigneeRole,
      acceptanceCriteria: input.acceptanceCriteria,
    }
    const { data } = await this.octokit.rest.issues.create({
      ...this.repo,
      title: input.title,
      body: renderBody(input.description, meta),
      labels: [`status:${input.status}`, `stage:${input.stage}`],
    })
    // Link the ticket as a native sub-issue of its epic (parent chain → trace context).
    await this.hierarchy.attachTicket(epicId, data.id)
    return toTicket(data)
  }

  async get(id: string): Promise<Ticket | null> {
    try {
      const { data } = await this.octokit.rest.issues.get({
        ...this.repo,
        issue_number: issueNumber(id),
      })
      return toTicket(data)
    } catch (err) {
      if ((err as { status?: number })?.status === 404) return null
      throw err
    }
  }

  async transition(id: string, status: TicketStatus): Promise<Ticket> {
    const issue_number = issueNumber(id)
    const { data: current } = await this.octokit.rest.issues.get({ ...this.repo, issue_number })
    const meta = { ...parseMeta(current.body ?? ""), status }
    const { data } = await this.octokit.rest.issues.update({
      ...this.repo,
      issue_number,
      state: status === "done" ? "closed" : "open",
      body: renderBody(stripMeta(current.body ?? ""), meta),
      labels: [`status:${status}`, `stage:${meta.stage}`],
    })
    return toTicket(data)
  }

  async list(filter?: { status?: TicketStatus }): Promise<Ticket[]> {
    const { data } = await this.octokit.rest.issues.listForRepo({
      ...this.repo,
      state: "all",
      per_page: 100,
    })
    const tickets = data.filter((i) => !i.pull_request).map(toTicket)
    return filter?.status ? tickets.filter((t) => t.status === filter.status) : tickets
  }
}
