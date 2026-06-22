import type { KnowledgeBase } from "@eng/core"
import type { Octokit } from "octokit"

function status(err: unknown): number | undefined {
  return (err as { status?: number })?.status
}

/**
 * KnowledgeBase backed by Markdown files in a GitHub repo via the Contents API. GitHub Wikis have no
 * REST/GraphQL API (only a `.wiki.git` repo), so docs live under a repo folder — the supported,
 * reviewable equivalent. Paths are relative to `prefix` (default `docs`).
 */
export class GitHubKnowledgeBase implements KnowledgeBase {
  constructor(
    private readonly octokit: Octokit,
    private readonly repo: { owner: string; repo: string },
    private readonly prefix = "docs",
    private readonly branch = "main",
  ) {}

  private full(path: string): string {
    return `${this.prefix}/${path}`.replace(/\/{2,}/g, "/")
  }

  async read(path: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        ...this.repo,
        path: this.full(path),
        ref: this.branch,
      })
      if (Array.isArray(data) || data.type !== "file") return null
      return Buffer.from(data.content, "base64").toString("utf-8")
    } catch (err) {
      if (status(err) === 404) return null
      throw err
    }
  }

  async write(path: string, content: string): Promise<void> {
    const full = this.full(path)
    let sha: string | undefined
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        ...this.repo,
        path: full,
        ref: this.branch,
      })
      if (!Array.isArray(data) && data.type === "file") sha = data.sha
    } catch (err) {
      if (status(err) !== 404) throw err
    }
    await this.octokit.rest.repos.createOrUpdateFileContents({
      ...this.repo,
      path: full,
      message: `docs: update ${full}`,
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch: this.branch,
      sha,
    })
  }

  async list(prefix = ""): Promise<string[]> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        ...this.repo,
        path: this.full(prefix),
        ref: this.branch,
      })
      if (!Array.isArray(data)) return []
      return data.filter((e) => e.type === "file").map((e) => e.path)
    } catch (err) {
      if (status(err) === 404) return []
      throw err
    }
  }
}
