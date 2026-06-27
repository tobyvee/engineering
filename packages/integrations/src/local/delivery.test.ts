import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { LocalGitDeliveryAdapter, localGitBranchFiles } from "./delivery"

describe("LocalGitDeliveryAdapter", () => {
  let dir: string
  let adapter: LocalGitDeliveryAdapter
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eng-localgit-"))
    adapter = new LocalGitDeliveryAdapter({ repoDir: dir, baseBranch: "main" })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("commits the agent's files to a local branch, then merges to main", async () => {
    await adapter.createBranch("main", "ticket/1")
    const { sha } = await adapter.commitFiles("ticket/1", "feat: add server", [
      { path: "src/index.ts", content: "export const x = 1\n" },
      { path: "README.md", content: "# app\n" },
    ])
    expect(sha).toMatch(/^[0-9a-f]{7,}$/)

    const files = await localGitBranchFiles(dir, "ticket/1")
    expect(files.map((f) => f.path).sort()).toEqual(["README.md", "src/index.ts"])
    expect(files.find((f) => f.path === "src/index.ts")?.content).toContain("export const x = 1")

    const pr = await adapter.openPullRequest({ branch: "ticket/1", title: "t", body: "b" })
    await adapter.merge(pr)
    const onMain = await localGitBranchFiles(dir, "main")
    expect(onMain.map((f) => f.path).sort()).toEqual(["README.md", "src/index.ts"])
  })

  it("reports a no-op deploy as success so the ship step doesn't poll forever", async () => {
    await adapter.dispatchWorkflow()
    const run = await adapter.deploymentRunAfter()
    expect(run?.state).toBe("success")
  })

  it("serializes concurrent ticket commits without cross-contamination", async () => {
    await Promise.all([
      (async () => {
        await adapter.createBranch("main", "ticket/A")
        await adapter.commitFiles("ticket/A", "A", [{ path: "a.txt", content: "A" }])
      })(),
      (async () => {
        await adapter.createBranch("main", "ticket/B")
        await adapter.commitFiles("ticket/B", "B", [{ path: "b.txt", content: "B" }])
      })(),
    ])
    const a = await localGitBranchFiles(dir, "ticket/A")
    const b = await localGitBranchFiles(dir, "ticket/B")
    expect(a.find((f) => f.path === "a.txt")?.content).toBe("A")
    expect(a.find((f) => f.path === "b.txt")).toBeUndefined()
    expect(b.find((f) => f.path === "b.txt")?.content).toBe("B")
    expect(b.find((f) => f.path === "a.txt")).toBeUndefined()
  })

  it("rejects writes that escape the repo", async () => {
    await adapter.createBranch("main", "ticket/x")
    await expect(
      adapter.commitFiles("ticket/x", "evil", [{ path: "../escape.txt", content: "no" }]),
    ).rejects.toThrow(/outside the repo/)
  })

  it("returns [] for a missing repo/branch", async () => {
    expect(await localGitBranchFiles(join(dir, "nope"), "main")).toEqual([])
    expect(await localGitBranchFiles(dir, "no-such-branch")).toEqual([])
  })
})
