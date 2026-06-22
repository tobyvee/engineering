import type { RoleId } from "@eng/core"

/** One upstream shaping stage: a role agent drafts an artifact for an epic before it's decomposed. */
export interface ShapingStage {
  key: string
  role: RoleId
  title: string
  task: string
}

/**
 * The upstream lifecycle as data, not code (invariant #6): PM discovery → UX design → architecture.
 * Each stage maps to a role and the artifact it drafts; they run in order, each seeing the earlier
 * artifacts, and the resulting docs feed the Lead Engineer's decomposition.
 */
export const SHAPING_STAGES: ShapingStage[] = [
  {
    key: "discovery",
    role: "pm",
    title: "Discovery & requirements",
    task: "Define the user needs, requirements, and acceptance criteria for this epic. Be concrete and testable.",
  },
  {
    key: "design",
    role: "ux_design",
    title: "Design spec",
    task: "Produce a concrete design spec for this epic: key user flows, screens/components, and states. Tie it to the requirements.",
  },
  {
    key: "architecture",
    role: "lead_architect",
    title: "Architecture decision (ADR)",
    task: "Record the architecture decision for this epic as a short ADR: the approach, key interfaces, alternatives considered, and trade-offs.",
  },
]

export function artifactPath(epicId: string, stageKey: string): string {
  return `epics/${epicId}/${stageKey}.md`
}
