import type { FileChange, RoleId, StoppedReason } from "@eng/core"
import { ClaudeWorker } from "./claude-worker"
import { PROPOSAL_SCHEMA } from "./schemas"

export interface ProposeChangesInput {
  role: RoleId
  systemPrompt: string
  goalContext: string
  /** What to build. */
  task: string
  budgetCentsRemaining: number
  /** Cloned target repo to work in (ENG-001) — the agent reads/edits real source there. */
  workdir?: string
}

export interface ProposedChanges {
  summary: string
  files: FileChange[]
  costCents: number
  stoppedReason: StoppedReason
  /**
   * Whether the model returned parseable JSON. `false` means the output couldn't be parsed (prose /
   * malformed) — distinct from a valid-but-empty change set, so the orchestrator can audit the two
   * differently (ENG-009).
   */
  parsed: boolean
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
    outputSchema: PROPOSAL_SCHEMA,
    workdir: input.workdir,
  })
  const { summary, files } = parseProposal(result.summary)
  return {
    summary,
    files,
    costCents: result.costCents,
    stoppedReason: result.stoppedReason,
    parsed: isParseableJson(result.summary),
  }
}

/** True iff the response contains a JSON object that parses — used to tell a parse failure (prose /
 *  malformed) from a valid-but-empty change set. */
export function isParseableJson(text: string): boolean {
  const json = extractJson(text)
  if (!json) return false
  try {
    JSON.parse(json)
    return true
  } catch {
    return false
  }
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
