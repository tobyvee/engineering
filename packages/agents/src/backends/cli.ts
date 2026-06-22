import { spawn } from "node:child_process"
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
 * Worker backend that drives the Claude Code CLI in print mode over stdio: the task is written to
 * the child's stdin, the structured result is read from stdout. Uses the CLI's own auth.
 */
export class CliBackend implements WorkerBackend {
  constructor(
    private readonly model: string,
    private readonly bin = process.env.CLAUDE_BIN ?? "claude",
  ) {}

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

    const stdout = await this.exec(args, input.task, signal)

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

  private exec(args: string[], stdin: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { signal })
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
