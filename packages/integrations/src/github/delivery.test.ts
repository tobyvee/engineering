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
})
