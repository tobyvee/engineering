/**
 * Delivery boundary (invariant #5): git host + CI behind one interface. The first implementation
 * targets GitHub; swapping hosts must not touch `core`.
 */
export interface PullRequestRef {
  number: number
  url: string
  branch: string
}

export type CheckState = "pending" | "success" | "failure"

export interface CheckStatus {
  name: string
  state: CheckState
}

export interface OpenPullRequestArgs {
  branch: string
  title: string
  body: string
}

/** A file to create or overwrite on a branch (full new contents). */
export interface FileChange {
  path: string
  content: string
}

export interface DeliveryAdapter {
  createBranch(base: string, name: string): Promise<void>
  /** Commit `files` onto `branch` (create/overwrite) and return the new commit SHA. */
  commitFiles(branch: string, message: string, files: FileChange[]): Promise<{ sha: string }>
  openPullRequest(args: OpenPullRequestArgs): Promise<PullRequestRef>
  getChecks(pr: PullRequestRef): Promise<CheckStatus[]>
  merge(pr: PullRequestRef): Promise<void>
}
