import type { CheckStatus, DeliveryAdapter, OpenPullRequestArgs, PullRequestRef } from "@eng/core"
import type { Octokit } from "octokit"

/**
 * First DeliveryAdapter target: GitHub (PRs + checks/Actions). Method bodies are stubbed pending
 * the delivery loop; the constructor already captures the octokit client and target repo.
 */
export class GitHubDeliveryAdapter implements DeliveryAdapter {
  constructor(
    private readonly octokit: Octokit,
    private readonly repo: { owner: string; repo: string },
  ) {}

  async createBranch(_base: string, _name: string): Promise<void> {
    if (!this.octokit) throw new Error("octokit not configured")
    // TODO: this.octokit.rest.git.createRef for `refs/heads/${_name}` from `_base`.
  }

  async openPullRequest(args: OpenPullRequestArgs): Promise<PullRequestRef> {
    const { owner, repo } = this.repo
    // TODO: this.octokit.rest.pulls.create({ owner, repo, head: args.branch, base, title, body }).
    return { number: 0, url: `https://github.com/${owner}/${repo}/pull/0`, branch: args.branch }
  }

  async getChecks(_pr: PullRequestRef): Promise<CheckStatus[]> {
    // TODO: this.octokit.rest.checks.listForRef(...) → map into CheckStatus[].
    return []
  }

  async merge(_pr: PullRequestRef): Promise<void> {
    // TODO: this.octokit.rest.pulls.merge(...).
  }
}
