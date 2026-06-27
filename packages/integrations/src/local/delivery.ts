import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve as pathResolve } from "node:path"
import type {
  CheckStatus,
  DeliveryAdapter,
  DeploymentRun,
  FileChange,
  OpenPullRequestArgs,
  PullRequestRef,
} from "@eng/core"

// Commit identity supplied per-commit so a freshly `git init`-ed repo doesn't need global git config.
const IDENT = ["-c", "user.email=agent@engineering.local", "-c", "user.name=engineering agent"]

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd })
    let out = ""
    let err = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (err += d))
    child.on("error", reject)
    child.on("close", (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error(`git ${args.join(" ")} → ${code}: ${err.trim()}`)),
    )
  })
}

export interface LocalGitDeliveryConfig {
  repoDir: string
  baseBranch?: string
}

/**
 * A `DeliveryAdapter` that commits to a **local** git repo (ENG-017) — no GitHub account or remote
 * required. The coding agent's proposed file changes become real, inspectable commits in the
 * working-code workspace, so QA can verify actual code and a ticket can reach `done` entirely offline.
 *
 * Concurrency: the worker is a single process, so all git operations are serialized through an
 * in-process queue and each `commitFiles`/`merge` is a self-contained `checkout -f → write → commit`
 * unit — concurrent ticket lifecycles can't race on the shared working tree. A "PR" is a local
 * branch; "merge" is a local `--no-ff` merge into the base branch; deploy hooks are no-ops (deploy
 * stays unconfigured locally).
 */
export class LocalGitDeliveryAdapter implements DeliveryAdapter {
  private readonly repoDir: string
  private readonly baseBranch: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(cfg: LocalGitDeliveryConfig) {
    this.repoDir = pathResolve(cfg.repoDir)
    this.baseBranch = cfg.baseBranch || "main"
  }

  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async ensureRepo(): Promise<void> {
    if (existsSync(join(this.repoDir, ".git"))) return
    await mkdir(this.repoDir, { recursive: true })
    await git(this.repoDir, ["-c", `init.defaultBranch=${this.baseBranch}`, "init"])
    await git(this.repoDir, [
      ...IDENT,
      "commit",
      "--allow-empty",
      "-m",
      "chore: initialize repository",
    ])
  }

  async createBranch(base: string, name: string): Promise<void> {
    await this.lock(async () => {
      await this.ensureRepo()
      await git(this.repoDir, ["branch", "-f", name, base || this.baseBranch])
    })
  }

  async commitFiles(
    branch: string,
    message: string,
    files: FileChange[],
  ): Promise<{ sha: string }> {
    return this.lock(async () => {
      await this.ensureRepo()
      await git(this.repoDir, ["checkout", "-f", branch])
      for (const f of files) {
        const abs = pathResolve(this.repoDir, f.path)
        if (abs !== this.repoDir && !abs.startsWith(`${this.repoDir}/`)) {
          throw new Error(`refusing to write outside the repo: ${f.path}`)
        }
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, f.content)
      }
      await git(this.repoDir, ["add", "-A"])
      await git(this.repoDir, [...IDENT, "commit", "-m", message])
      return { sha: await git(this.repoDir, ["rev-parse", "HEAD"]) }
    })
  }

  async openPullRequest(args: OpenPullRequestArgs): Promise<PullRequestRef> {
    return { number: 0, url: `file://${this.repoDir}#${args.branch}`, branch: args.branch }
  }

  async getChecks(): Promise<CheckStatus[]> {
    return [] // no CI locally → aggregates to success
  }

  async merge(pr: PullRequestRef): Promise<void> {
    await this.lock(async () => {
      await git(this.repoDir, ["checkout", "-f", this.baseBranch])
      await git(this.repoDir, [...IDENT, "merge", "--no-ff", pr.branch, "-m", `merge ${pr.branch}`])
    })
  }

  // Deploy is a no-op locally (the deploy workflow stays unconfigured); present to satisfy the port.
  dispatchWorkflow(): Promise<void> {
    return Promise.resolve()
  }
  latestRunId(): Promise<number | null> {
    return Promise.resolve(null)
  }
  deploymentRunAfter(): Promise<DeploymentRun | null> {
    return Promise.resolve(null)
  }
}

/**
 * Read the files committed on `branch` of a local repo, for QA verification (ENG-017). Reads via git
 * (not the working tree) so it's safe under concurrent ticket runs, and is bounded so a large tree
 * can't blow up the prompt. Returns `[]` when the repo or branch doesn't exist yet.
 */
export async function localGitBranchFiles(
  repoDir: string,
  branch: string,
  opts: { maxFiles?: number; maxBytes?: number } = {},
): Promise<FileChange[]> {
  const dir = pathResolve(repoDir)
  if (!existsSync(join(dir, ".git"))) return []
  const maxFiles = opts.maxFiles ?? 40
  const maxBytes = opts.maxBytes ?? 60_000
  let list: string
  try {
    list = await git(dir, ["ls-tree", "-r", "--name-only", branch])
  } catch {
    return [] // branch doesn't exist
  }
  const paths = list
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, maxFiles)
  const files: FileChange[] = []
  let bytes = 0
  for (const p of paths) {
    let content: string
    try {
      content = await git(dir, ["show", `${branch}:${p}`])
    } catch {
      continue
    }
    bytes += content.length
    if (bytes > maxBytes) {
      files.push({ path: p, content: "(omitted — size budget reached)" })
      break
    }
    files.push({ path: p, content })
  }
  return files
}
