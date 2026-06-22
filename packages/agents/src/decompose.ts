import type { RoleId, StoppedReason } from "@eng/core"
import { ClaudeWorker } from "./claude-worker"
import { extractJson } from "./propose"

/** A ticket proposed by the Lead Engineer when decomposing an epic. */
export interface ProposedTicket {
  title: string
  description: string
  acceptanceCriteria: string[]
  assigneeRole: RoleId | null
}

export interface ProposeTicketsInput {
  role: RoleId
  systemPrompt: string
  goalContext: string
  /** What to decompose. */
  task: string
  budgetCentsRemaining: number
}

export interface ProposedTickets {
  tickets: ProposedTicket[]
  costCents: number
  stoppedReason: StoppedReason
}

const ROLE_IDS: ReadonlySet<string> = new Set<RoleId>([
  "pm",
  "ux_design",
  "lead_architect",
  "lead_system_design",
  "lead_engineer",
  "staff_engineer",
  "qa_test",
])

const CONTRACT =
  'Respond with ONLY a JSON object {"tickets": [{"title": string, "description": string, ' +
  '"acceptanceCriteria": string[], "assigneeRole": string}]}. Break the epic into 2–6 small, ' +
  "independently implementable tickets, each with concrete acceptance criteria and the most " +
  "appropriate assignee role (one of: pm, ux_design, lead_architect, lead_system_design, " +
  "lead_engineer, staff_engineer, qa_test)."

/** Run the Lead Engineer agent and parse a set of proposed tickets from its response. */
export async function proposeTickets(input: ProposeTicketsInput): Promise<ProposedTickets> {
  const result = await new ClaudeWorker().run({
    role: input.role,
    systemPrompt: input.systemPrompt,
    tools: [],
    goalContext: input.goalContext,
    task: `${input.task}\n\n${CONTRACT}`,
    budgetCentsRemaining: input.budgetCentsRemaining,
  })
  return {
    tickets: parseTickets(result.summary),
    costCents: result.costCents,
    stoppedReason: result.stoppedReason,
  }
}

/** Best-effort extraction of proposed tickets from a model response. Unknown roles → unassigned;
 *  titleless or malformed entries are dropped; non-JSON output yields an empty list. */
export function parseTickets(text: string): ProposedTicket[] {
  const json = extractJson(text)
  if (!json) return []
  try {
    const obj = JSON.parse(json) as { tickets?: unknown }
    if (!Array.isArray(obj.tickets)) return []
    return obj.tickets
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t) => ({
        title: typeof t.title === "string" ? t.title : "",
        description: typeof t.description === "string" ? t.description : "",
        acceptanceCriteria: Array.isArray(t.acceptanceCriteria)
          ? t.acceptanceCriteria.filter((c): c is string => typeof c === "string")
          : [],
        assigneeRole:
          typeof t.assigneeRole === "string" && ROLE_IDS.has(t.assigneeRole)
            ? (t.assigneeRole as RoleId)
            : null,
      }))
      .filter((t) => t.title.length > 0)
  } catch {
    return []
  }
}
