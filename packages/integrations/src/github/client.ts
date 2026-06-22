import { Octokit } from "octokit"
import { GitHubDeliveryAdapter } from "./delivery"

export interface GitHubDeliveryConfig {
  /** A GitHub token with `contents` + `pull_requests` write access. */
  token: string
  owner: string
  repo: string
  /** Branch PRs target and new branches fork from. Defaults to `main`. */
  baseBranch?: string
}

/** Build a GitHubDeliveryAdapter from a token + repo coordinates. */
export function createGitHubDelivery(config: GitHubDeliveryConfig): GitHubDeliveryAdapter {
  const octokit = new Octokit({ auth: config.token })
  return new GitHubDeliveryAdapter(
    octokit,
    { owner: config.owner, repo: config.repo },
    config.baseBranch,
  )
}
