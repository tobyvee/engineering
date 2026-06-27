import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { dirname, join, resolve as pathResolve } from "node:path"
import type { WorkerInput, WorkerResult } from "@eng/core"
import type { WorkerBackend } from "../claude-worker"
import { buildSystemPrompt } from "../prompt"

/** Shape of `claude -p --output-format json` output (the fields we use). */
interface CliResult {
  subtype?: string
  is_error?: boolean
  result?: string
  total_cost_usd?: number
}

/**
 * Resolve the sandbox root for cli-backend agents. `claude -p` is the *full* Claude Code agent — it
 * has filesystem + bash tools — so running it in the repo lets agents mutate source. Every agent
 * instead runs in a throwaway directory under `<repo>/workspaces/`. Override with
 * `AGENT_WORKSPACE_DIR`; otherwise the repo root (the dir with `pnpm-workspace.yaml`) is located so
 * the sandbox is the top-level `workspaces/` regardless of the worker's cwd.
 */
export function resolveWorkspaceRoot(): string {
  const override = process.env.AGENT_WORKSPACE_DIR
  if (override) return pathResolve(override)
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, "workspaces")
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return pathResolve(process.cwd(), "workspaces")
}

/** Create an isolated, unique per-run sandbox directory under the workspace root. */
export async function createSandbox(root: string, role: string): Promise<string> {
  await mkdir(root, { recursive: true })
  return mkdtemp(join(root, `${role}-`))
}

/**
 * Env vars forwarded into the agent sandbox (ENG-005). `claude -p` is the full Claude Code agent with
 * bash + filesystem tools, so the child must NOT inherit the host environment — secrets like
 * `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, and `DATABASE_URL` would otherwise be readable from the agent's
 * shell. Only this benign allow-list is passed; the CLI authenticates via its own login under `HOME`.
 */
const SANDBOX_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
] as const

/**
 * Build the scrubbed environment for a sandboxed agent run: the allow-list above, plus any names
 * explicitly opted in via `AGENT_SANDBOX_ENV_PASSTHROUGH` (comma-separated). Everything else — notably
 * credentials — is withheld. Pure and side-effect-free for testability.
 */
export function sandboxEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of SANDBOX_ENV_ALLOWLIST) {
    const value = source[key]
    if (value !== undefined) env[key] = value
  }
  const extra = source.AGENT_SANDBOX_ENV_PASSTHROUGH
  if (extra) {
    for (const key of extra
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const value = source[key]
      if (value !== undefined) env[key] = value
    }
  }
  return env
}

export interface CliBackendOptions {
  bin?: string
  workspaceRoot?: string
}

/**
 * Worker backend that drives the Claude Code CLI in print mode over stdio: the task is written to
 * the child's stdin, the structured result is read from stdout. Uses the CLI's own auth. The child
 * runs with its cwd set to a throwaway sandbox under `workspaces/`, so its tools are confined there
 * and can never write to repo source (invariant #5 — runtimes don't reach past their boundary).
 */
export class CliBackend implements WorkerBackend {
  private readonly bin: string
  private readonly workspaceRoot: string

  constructor(
    private readonly model: string,
    opts: CliBackendOptions = {},
  ) {
    this.bin = opts.bin ?? process.env.CLAUDE_BIN ?? "claude"
    this.workspaceRoot = opts.workspaceRoot ?? resolveWorkspaceRoot()
  }

  async run(input: WorkerInput, signal?: AbortSignal): Promise<WorkerResult> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      this.model,
      "--append-system-prompt",
      buildSystemPrompt(input),
    ]

    // Confine the agent's file/bash tools to a throwaway sandbox — never the repo source.
    const sandbox = await createSandbox(this.workspaceRoot, input.role)
    let stdout: string
    try {
      stdout = await this.exec(args, input.task, sandbox, signal)
    } finally {
      if (!process.env.AGENT_KEEP_WORKSPACE) await rm(sandbox, { recursive: true, force: true })
    }

    let parsed: CliResult | undefined
    try {
      parsed = JSON.parse(stdout) as CliResult
    } catch {
      // Fall back to treating raw stdout as the result if it wasn't JSON.
      return {
        summary: stdout.trim() || `[${input.role}] (no output)`,
        toolCalls: [],
        costCents: 0,
        stoppedReason: "completed",
      }
    }

    const costCents = parsed.total_cost_usd
      ? Math.round(parsed.total_cost_usd * 100 * 100) / 100
      : 0

    return {
      summary: parsed.result?.trim() || `[${input.role}] (no output)`,
      toolCalls: [],
      costCents,
      stoppedReason: parsed.is_error ? "blocked" : "completed",
    }
  }

  private exec(args: string[], stdin: string, cwd: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      // Scrubbed env (ENG-005): the agent's tools never see host secrets.
      const child = spawn(this.bin, args, { cwd, signal, env: sandboxEnv() })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString()
      })
      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`${this.bin} exited with code ${code}: ${stderr.trim()}`))
      })
      child.stdin.end(stdin)
    })
  }
}
