import type { Octokit } from "octokit"
import { describe, expect, it, vi } from "vitest"
import { GitHubKnowledgeBase } from "./knowledge"

function kbWith(repos: Record<string, unknown>): GitHubKnowledgeBase {
  return new GitHubKnowledgeBase({ rest: { repos } } as unknown as Octokit, {
    owner: "acme",
    repo: "widgets",
  })
}

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64")

describe("GitHubKnowledgeBase", () => {
  it("reads and base64-decodes a file under the docs prefix", async () => {
    const getContent = vi
      .fn()
      .mockResolvedValue({ data: { type: "file", content: b64("hello kb") } })
    const text = await kbWith({ getContent }).read("notes.md")
    expect(text).toBe("hello kb")
    expect(getContent).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      path: "docs/notes.md",
      ref: "main",
    })
  })

  it("returns null for a missing file (404)", async () => {
    const getContent = vi.fn().mockRejectedValue({ status: 404 })
    expect(await kbWith({ getContent }).read("missing.md")).toBeNull()
  })

  it("writes with the existing sha when the file exists", async () => {
    const getContent = vi.fn().mockResolvedValue({ data: { type: "file", sha: "abc" } })
    const createOrUpdateFileContents = vi.fn().mockResolvedValue({ data: {} })
    await kbWith({ getContent, createOrUpdateFileContents }).write("notes.md", "new content")
    expect(createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "docs/notes.md",
        sha: "abc",
        branch: "main",
        content: b64("new content"),
      }),
    )
  })

  it("writes without a sha when the file is new (404 on read)", async () => {
    const getContent = vi.fn().mockRejectedValue({ status: 404 })
    const createOrUpdateFileContents = vi.fn().mockResolvedValue({ data: {} })
    await kbWith({ getContent, createOrUpdateFileContents }).write("new.md", "x")
    expect(createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ sha: undefined }),
    )
  })

  it("lists only files in a directory", async () => {
    const getContent = vi.fn().mockResolvedValue({
      data: [
        { type: "file", path: "docs/a.md" },
        { type: "dir", path: "docs/sub" },
      ],
    })
    expect(await kbWith({ getContent }).list()).toEqual(["docs/a.md"])
  })
})
