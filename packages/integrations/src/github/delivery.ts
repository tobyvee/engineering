import type {
  CheckState,
  CheckStatus,
  DeliveryAdapter,
  OpenPullRequestArgs,
  PullRequestRef,
} from "@eng/core"
import type { Octokit } from "octokit"

/**
 * First DeliveryAdapter target: GitHub — branches, PRs, and checks/Actions over the REST API
 * (octokit). `core` only ever sees the DeliveryAdapter interface (invariant #5), so the delivery
 * host can be swapped without touching the domain.
 */
export class GitHubDeliveryAdapter implements DeliveryAdapter {
  constructor(
    private readonly octokit: Octokit,
    private readonly repo: { owner: string; repo: string },
    private readonly baseBranch = "main",
  ) {}

  async createBranch(base: string, name: string): Promise<void> {
    const { data: ref } = await this.octokit.rest.git.getRef({
      ...this.repo,
      ref: `heads/${base}`,
    })
    await this.octokit.rest.git.createRef({
      ...this.repo,
      ref: `refs/heads/${name}`,
      sha: ref.object.sha,
    })
  }

  async openPullRequest(args: OpenPullRequestArgs): Promise<PullRequestRef> {
    const { data: pr } = await this.octokit.rest.pulls.create({
      ...this.repo,
      head: args.branch,
      base: this.baseBranch,
      title: args.title,
      body: args.body,
    })
    return { number: pr.number, url: pr.html_url, branch: args.branch }
  }

  async getChecks(pr: PullRequestRef): Promise<CheckStatus[]> {
    const { data } = await this.octokit.rest.checks.listForRef({
      ...this.repo,
      ref: pr.branch,
    })
    return data.check_runs.map((run) => ({
      name: run.name,
      state: toCheckState(run.status, run.conclusion),
    }))
  }

  async merge(pr: PullRequestRef): Promise<void> {
    await this.octokit.rest.pulls.merge({
      ...this.repo,
      pull_number: pr.number,
    })
  }
}

/** Collapse a GitHub check-run's status + conclusion into our three-state model. */
function toCheckState(status: string, conclusion: string | null): CheckState {
  if (status !== "completed") return "pending"
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
    return "success"
  }
  return "failure"
}
