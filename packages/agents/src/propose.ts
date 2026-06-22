import type { FileChange, RoleId, StoppedReason } from "@eng/core"
import { ClaudeWorker } from "./claude-worker"

export interface ProposeChangesInput {
  role: RoleId
  systemPrompt: string
  goalContext: string
  /** What to build. */
  task: string
  budgetCentsRemaining: number
}

export interface ProposedChanges {
  summary: string
  files: FileChange[]
  costCents: number
  stoppedReason: StoppedReason
}

const CONTRACT =
  'Respond with ONLY a JSON object of the form {"summary": string, "files": [{"path": string, ' +
  '"content": string}]}. Each file\'s "content" is its full new text; use repo-relative paths. ' +
  "Return an empty files array if no code change is needed."

/** Run the coding agent and parse a set of file changes from its response. */
export async function proposeFileChanges(input: ProposeChangesInput): Promise<ProposedChanges> {
  const result = await new ClaudeWorker().run({
    role: input.role,
    systemPrompt: input.systemPrompt,
    tools: [],
    goalContext: input.goalContext,
    task: `${input.task}\n\n${CONTRACT}`,
    budgetCentsRemaining: input.budgetCentsRemaining,
  })
  const { summary, files } = parseProposal(result.summary)
  return { summary, files, costCents: result.costCents, stoppedReason: result.stoppedReason }
}

export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

/** Best-effort extraction of `{ summary, files }` from a model response. */
export function parseProposal(text: string): { summary: string; files: FileChange[] } {
  const json = extractJson(text)
  if (json) {
    try {
      const obj = JSON.parse(json) as { summary?: unknown; files?: unknown }
      const files = Array.isArray(obj.files)
        ? obj.files
            .filter(
              (f): f is FileChange =>
                !!f &&
                typeof (f as FileChange).path === "string" &&
                typeof (f as FileChange).content === "string",
            )
            .map((f) => ({ path: f.path, content: f.content }))
        : []
      const summary = typeof obj.summary === "string" ? obj.summary : text.trim()
      return { summary, files }
    } catch {
      // fall through to the prose fallback
    }
  }
  return { summary: text.trim(), files: [] }
}
