import type { Octokit } from "octokit"
import { describe, expect, it, vi } from "vitest"
import { GitHubDeliveryAdapter } from "./delivery"

const repo = { owner: "acme", repo: "widgets" }

function adapterWith(rest: Record<string, unknown>): GitHubDeliveryAdapter {
  return new GitHubDeliveryAdapter({ rest } as unknown as Octokit, repo)
}

describe("GitHubDeliveryAdapter", () => {
  it("creates a branch from the base ref's SHA", async () => {
    const getRef = vi.fn().mockResolvedValue({ data: { object: { sha: "deadbeef" } } })
    const createRef = vi.fn().mockResolvedValue({ data: {} })

    await adapterWith({ git: { getRef, createRef } }).createBranch("main", "feature/x")

    expect(getRef).toHaveBeenCalledWith({ owner: "acme", repo: "widgets", ref: "heads/main" })
    expect(createRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      ref: "refs/heads/feature/x",
      sha: "deadbeef",
    })
  })

  it("opens a PR and returns its ref", async () => {
    const create = vi.fn().mockResolvedValue({
      data: { number: 7, html_url: "https://github.com/acme/widgets/pull/7" },
    })

    const ref = await adapterWith({ pulls: { create } }).openPullRequest({
      branch: "feature/x",
      title: "Add x",
      body: "does x",
    })

    expect(ref).toEqual({
      number: 7,
      url: "https://github.com/acme/widgets/pull/7",
      branch: "feature/x",
    })
    expect(create).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      head: "feature/x",
      base: "main",
      title: "Add x",
      body: "does x",
    })
  })

  it("maps check-run status + conclusion to CheckState", async () => {
    const listForRef = vi.fn().mockResolvedValue({
      data: {
        check_runs: [
          { name: "build", status: "completed", conclusion: "success" },
          { name: "lint", status: "in_progress", conclusion: null },
          { name: "test", status: "completed", conclusion: "failure" },
          { name: "optional", status: "completed", conclusion: "skipped" },
        ],
      },
    })

    const checks = await adapterWith({ checks: { listForRef } }).getChecks({
      number: 7,
      url: "",
      branch: "feature/x",
    })

    expect(checks).toEqual([
      { name: "build", state: "success" },
      { name: "lint", state: "pending" },
      { name: "test", state: "failure" },
      { name: "optional", state: "success" },
    ])
  })

  it("merges by pull number", async () => {
    const merge = vi.fn().mockResolvedValue({ data: { merged: true } })

    await adapterWith({ pulls: { merge } }).merge({ number: 7, url: "", branch: "feature/x" })

    expect(merge).toHaveBeenCalledWith({ owner: "acme", repo: "widgets", pull_number: 7 })
  })

  it("commits files via the Git Data API and moves the branch ref", async () => {
    const getRef = vi.fn().mockResolvedValue({ data: { object: { sha: "base-commit" } } })
    const getCommit = vi.fn().mockResolvedValue({ data: { tree: { sha: "base-tree" } } })
    const createTree = vi.fn().mockResolvedValue({ data: { sha: "new-tree" } })
    const createCommit = vi.fn().mockResolvedValue({ data: { sha: "new-commit" } })
    const updateRef = vi.fn().mockResolvedValue({ data: {} })

    const res = await adapterWith({
      git: { getRef, getCommit, createTree, createCommit, updateRef },
    }).commitFiles("feature/x", "feat: add a", [
      { path: "src/a.ts", content: "export const a = 1\n" },
    ])

    expect(res).toEqual({ sha: "new-commit" })
    expect(getCommit).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      commit_sha: "base-commit",
    })
    expect(createTree).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      base_tree: "base-tree",
      tree: [{ path: "src/a.ts", mode: "100644", type: "blob", content: "export const a = 1\n" }],
    })
    expect(createCommit).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      message: "feat: add a",
      tree: "new-tree",
      parents: ["base-commit"],
    })
    expect(updateRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      ref: "heads/feature/x",
      sha: "new-commit",
    })
  })

  it("dispatches a deploy workflow", async () => {
    const createWorkflowDispatch = vi.fn().mockResolvedValue({ data: {} })

    await adapterWith({ actions: { createWorkflowDispatch } }).dispatchWorkflow({
      workflow: "deploy.yml",
      ref: "main",
      inputs: { ticket: "t1" },
    })

    expect(createWorkflowDispatch).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      workflow_id: "deploy.yml",
      ref: "main",
      inputs: { ticket: "t1" },
    })
  })

  it("finds the latest deploy run and maps its state", async () => {
    const listWorkflowRuns = vi.fn().mockResolvedValue({
      data: {
        workflow_runs: [
          {
            id: 99,
            html_url: "https://github.com/acme/widgets/actions/runs/99",
            status: "completed",
            conclusion: "success",
          },
        ],
      },
    })

    const run = await adapterWith({ actions: { listWorkflowRuns } }).latestDeploymentRun({
      workflow: "deploy.yml",
      ref: "main",
      since: "2026-06-22T00:00:00Z",
    })

    expect(run).toEqual({
      id: 99,
      url: "https://github.com/acme/widgets/actions/runs/99",
      state: "success",
    })
    expect(listWorkflowRuns).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      workflow_id: "deploy.yml",
      event: "workflow_dispatch",
      branch: "main",
      created: ">=2026-06-22T00:00:00Z",
      per_page: 1,
    })
  })

  it("returns null when no deploy run exists yet", async () => {
    const listWorkflowRuns = vi.fn().mockResolvedValue({ data: { workflow_runs: [] } })

    const run = await adapterWith({ actions: { listWorkflowRuns } }).latestDeploymentRun({
      workflow: "deploy.yml",
      ref: "main",
      since: "x",
    })

    expect(run).toBeNull()
  })
})
