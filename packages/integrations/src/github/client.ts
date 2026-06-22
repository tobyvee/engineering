import { Octokit } from "octokit"
import { GitHubDeliveryAdapter } from "./delivery"
import { GitHubIssueTracker } from "./issues"
import { GitHubKnowledgeBase } from "./knowledge"

export interface GitHubConfig {
  /** A GitHub token (contents + pull_requests + issues write access). */
  token: string
  owner: string
  repo: string
}

export interface GitHubDeliveryConfig extends GitHubConfig {
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

/** Build a GitHubIssueTracker from a token + repo coordinates. */
export function createGitHubIssueTracker(config: GitHubConfig): GitHubIssueTracker {
  return new GitHubIssueTracker(new Octokit({ auth: config.token }), {
    owner: config.owner,
    repo: config.repo,
  })
}

/** Build a GitHubKnowledgeBase (repo docs via the Contents API). */
export function createGitHubKnowledgeBase(
  config: GitHubConfig & { prefix?: string; branch?: string },
): GitHubKnowledgeBase {
  return new GitHubKnowledgeBase(
    new Octokit({ auth: config.token }),
    { owner: config.owner, repo: config.repo },
    config.prefix,
    config.branch,
  )
}
