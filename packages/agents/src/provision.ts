import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { repoWorkspacePath } from "./workspace"

/**
 * Repository provisioning (ENG-013): clone the target repo into the working-code workspace so coding
 * agents (ENG-001) have real source to read and edit. The PM agent owns this via its granted `git`/`gh`
 * tools; this module is the *deterministic backbone* the lifecycle calls to guarantee (and verify) the
 * clone exists regardless of the agent turn — idempotent, and a no-op when GitHub isn't configured.
 */

export interface RepoTarget {
  owner: string
  repo: string
  /** Scoped token for private clones; the PM-scoped token is preferred over the host delivery token. */
  token?: string
}

/** Resolve the target repo from env (reuses the delivery config). Null when unconfigured (skip). */
export function repoTargetFromEnv(env: NodeJS.ProcessEnv = process.env): RepoTarget | null {
  const owner = env.GITHUB_OWNER
  const repo = env.GITHUB_REPO
  if (!owner || !repo) return null
  return { owner, repo, token: env.AGENT_PM_GITHUB_TOKEN ?? env.GITHUB_TOKEN }
}

export type ProvisionAction = "clone" | "pull"

/** Pure idempotency decision: an existing checkout is pulled, otherwise cloned fresh. */
export function provisionAction(dir: string): ProvisionAction {
  return existsSync(join(dir, ".git")) ? "pull" : "clone"
}

export interface CloneResult {
  path: string
  action: ProvisionAction
}

/** `git` args for the action — token (if any) injected via http.extraheader so it never lands in
 *  `.git/config`. Pure, for testing. */
export function gitArgs(action: ProvisionAction, dir: string, target: RepoTarget): string[] {
  const auth = target.token ? ["-c", `http.extraheader=AUTHORIZATION: bearer ${target.token}`] : []
  if (action === "pull") return ["-C", dir, ...auth, "pull", "--ff-only"]
  const url = `https://github.com/${target.owner}/${target.repo}.git`
  return [...auth, "clone", "--depth", "1", url, dir]
}

function runGit(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: "ignore" })
    child.on("error", reject)
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`git exited with code ${code}`)),
    )
  })
}

/**
 * Ensure the target repo is cloned into the working-code workspace, idempotently. Returns the clone
 * path + the action taken, or `null` when GitHub isn't configured (caller audits the skip). Operates
 * only under the working-code workspace — never this product's own tree.
 */
export async function ensureRepoCloned(
  target: RepoTarget | null = repoTargetFromEnv(),
): Promise<CloneResult | null> {
  if (!target) return null
  const dir = repoWorkspacePath(target.owner, target.repo)
  const action = provisionAction(dir)
  if (action === "clone") await mkdir(dirname(dir), { recursive: true })
  await runGit(gitArgs(action, dir, target))
  return { path: dir, action }
}
