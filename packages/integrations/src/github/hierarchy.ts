import type { Hierarchy, IssueTracker, KnowledgeBase } from "@eng/core"

const HIERARCHY_PATH = "hierarchy.json"

/** The mission→goal→epic tree, stored as a versioned repo doc; tickets (issues) reference an epic. */
interface HierarchyDoc {
  mission: { title: string; statement: string }
  goals: Record<string, { title: string; description: string }>
  epics: Record<string, { title: string; goalId: string }>
}

const DEFAULT_DOC: HierarchyDoc = {
  mission: { title: "Deliver the product", statement: "Ship value to users." },
  goals: { "goal-1": { title: "Bootstrap the unit", description: "Stand up delivery." } },
  epics: { "epic-1": { title: "Vertical slice", goalId: "goal-1" } },
}

async function readDoc(knowledge: KnowledgeBase): Promise<HierarchyDoc | null> {
  const raw = await knowledge.read(HIERARCHY_PATH)
  if (!raw) return null
  try {
    return JSON.parse(raw) as HierarchyDoc
  } catch {
    return null
  }
}

/** Ensure the hierarchy doc + a default epic exist; return the epic id (seeds on first use). */
export async function ensureSeedEpicId(knowledge: KnowledgeBase): Promise<string> {
  const doc = await readDoc(knowledge)
  const existing = doc && Object.keys(doc.epics)[0]
  if (existing) return existing
  await knowledge.write(HIERARCHY_PATH, JSON.stringify(DEFAULT_DOC, null, 2))
  return "epic-1"
}

/**
 * Hierarchy backed by GitHub: the mission→goal→epic tree lives in a versioned repo doc (via the
 * KnowledgeBase) and tickets (issues) reference an epic id. `traceContext` walks epic → goal →
 * mission to reconstruct the chain — so trace works even though Issues are flat.
 */
export class GitHubHierarchy implements Hierarchy {
  constructor(
    private readonly tracker: IssueTracker,
    private readonly knowledge: KnowledgeBase,
  ) {}

  async traceContext(ticketId: string): Promise<string> {
    const [ticket, doc] = await Promise.all([this.tracker.get(ticketId), readDoc(this.knowledge)])
    if (!ticket || !doc) return `Ticket ${ticketId} (no trace context found).`
    const epic = doc.epics[ticket.epicId]
    const goal = epic ? doc.goals[epic.goalId] : undefined
    return [
      `Mission: ${doc.mission.title} — ${doc.mission.statement}`,
      goal ? `Goal: ${goal.title} — ${goal.description}` : "Goal: (unknown)",
      epic ? `Epic: ${epic.title}` : "Epic: (unknown)",
      `Ticket: ${ticket.title}`,
    ].join("\n")
  }
}
