import { existsSync } from "node:fs"
import { dirname, join, resolve as pathResolve } from "node:path"

/**
 * The two sandboxed roots (ENG-013). Agents have two distinct filesystem areas, never conflated:
 *
 *   1. **Agent-state sandbox** — throwaway, per-run scratch under `workspaces/<role>-xxxx`
 *      (`resolveWorkspaceRoot` in `backends/cli.ts`, env `AGENT_WORKSPACE_DIR`). Ephemeral; no product
 *      code lives here.
 *   2. **Working-code workspace** — *persistent* shared root holding cloned target repos that agents
 *      inspect and modify (this module, env `AGENT_CODE_WORKSPACE`).
 *
 * This module owns the working-code root and the per-repo path layout.
 */

/** Walk up to the monorepo root (the dir containing `pnpm-workspace.yaml`); falls back to `start`. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return start
}

/**
 * Root of the persistent working-code workspace. Override with `AGENT_CODE_WORKSPACE`; otherwise a
 * top-level `workspace/` (singular — deliberately distinct from the throwaway `workspaces/` plural).
 */
export function resolveCodeWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AGENT_CODE_WORKSPACE
  if (override) return pathResolve(override)
  return join(findRepoRoot(), "workspace")
}

/** Path of a cloned target repo within the working-code workspace: `<root>/<owner>/<repo>`. */
export function repoWorkspacePath(
  owner: string,
  repo: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveCodeWorkspaceRoot(env), owner, repo)
}
