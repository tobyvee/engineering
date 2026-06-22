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

export type DeployState = "pending" | "success" | "failure"

export interface DeploymentRun {
  id: number
  url: string
  state: DeployState
}

export interface DispatchDeployArgs {
  /** Workflow file name or numeric id (e.g. "deploy.yml"). */
  workflow: string
  /** Git ref to deploy (branch or SHA). */
  ref: string
  inputs?: Record<string, string>
}

export interface DeliveryAdapter {
  createBranch(base: string, name: string): Promise<void>
  /** Commit `files` onto `branch` (create/overwrite) and return the new commit SHA. */
  commitFiles(branch: string, message: string, files: FileChange[]): Promise<{ sha: string }>
  openPullRequest(args: OpenPullRequestArgs): Promise<PullRequestRef>
  getChecks(pr: PullRequestRef): Promise<CheckStatus[]>
  merge(pr: PullRequestRef): Promise<void>
  /** Trigger a GitHub Actions deploy via workflow_dispatch (fire-and-forget; returns no run id). */
  dispatchWorkflow(args: DispatchDeployArgs): Promise<void>
  /** Newest workflow_dispatch run id for `workflow` on `ref` (null if none) — capture before dispatch. */
  latestRunId(args: { workflow: string; ref: string }): Promise<number | null>
  /** Newest workflow_dispatch run for `workflow` on `ref` with id greater than `afterRunId`. */
  deploymentRunAfter(args: {
    workflow: string
    ref: string
    afterRunId: number
  }): Promise<DeploymentRun | null>
}
