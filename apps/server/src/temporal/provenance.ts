import type { Actor, DecisionAlternative, LifecycleStage, WorkItemRef } from "@eng/core"
import { persistenceFromEnv } from "../persistence"

/**
 * Decision-provenance helpers (ENG-014). Each agent step emits a structured `Decision` linked to its
 * parent(s), its work item, and the originating request — a queryable DAG layered over the
 * append-only audit log (which it references, never copies). The **trace id is the epic id**
 * (`rootRequestId = epicId`): every shaping / decompose / implement / QA decision for an epic shares
 * it, so the whole chain is retrievable by root.
 *
 * Provenance is a layer *over* the lifecycle — it must never break it, so every write is best-effort.
 */
const persistence = persistenceFromEnv()

/** Map a shaping-stage key to the macro lifecycle stage (system design sits within architecture). */
export const SHAPING_STAGE_TO_LIFECYCLE: Record<string, LifecycleStage> = {
  discovery: "discovery",
  design: "design",
  architecture: "architecture",
  system_design: "architecture",
}

/**
 * Ensure the epic's root request decision exists (idempotent) — the node every chain reaches, with no
 * parents. Returns its id. The root captures the originating ask (the epic's why).
 */
export async function ensureRootDecision(epicId: string): Promise<string> {
  const existing = await persistence.decisions.byWorkItem({ epicId })
  const root = existing.find((d) => d.parentDecisionIds.length === 0)
  if (root) return root.id
  const epicCtx = await persistence.hierarchy.epicContext(epicId).catch(() => `Epic ${epicId}`)
  const created = await persistence.decisions.record({
    rootRequestId: epicId,
    parentDecisionIds: [],
    missionId: null,
    goalId: null,
    epicId,
    ticketId: null,
    actor: "human",
    stage: "discovery",
    statement: "Originating request",
    rationale: epicCtx,
    alternatives: [],
    inputs: [],
    outputs: [],
    confidence: null,
    costCents: null,
    auditEventId: null,
  })
  return created.id
}

/** Newest decision id attached to a work scope — the natural parent for the next step, or null. */
async function latestDecisionId(ref: WorkItemRef): Promise<string | null> {
  const ds = await persistence.decisions.byWorkItem(ref)
  return ds[0]?.id ?? null
}

export interface StepDecision {
  epicId: string
  ticketId?: string | null
  actor: Actor
  stage: LifecycleStage
  statement: string
  rationale: string
  alternatives?: DecisionAlternative[]
  inputs?: string[]
  outputs?: string[]
  confidence?: number | null
  costCents?: number | null
  auditEventId?: string | null
  /** Explicit parents; when omitted, links to the newest decision in the ticket → epic scope. */
  parentIds?: string[]
}

/**
 * Record a structured decision for an agent step, linking it to its parent(s), its work item, and the
 * epic-rooted trace. When `parentIds` is omitted the parent is inferred as the newest decision in the
 * ticket scope (the implement→QA→rework chain), falling back to the epic scope (the shaping→decompose
 * handoff) — always non-empty because the root is seeded first. Best-effort by design.
 */
export async function recordStepDecision(step: StepDecision): Promise<void> {
  try {
    await ensureRootDecision(step.epicId)
    let parentIds = step.parentIds
    if (!parentIds) {
      const parent =
        (step.ticketId ? await latestDecisionId({ ticketId: step.ticketId }) : null) ??
        (await latestDecisionId({ epicId: step.epicId }))
      parentIds = parent ? [parent] : []
    }
    await persistence.decisions.record({
      rootRequestId: step.epicId,
      parentDecisionIds: parentIds,
      missionId: null,
      goalId: null,
      epicId: step.epicId,
      ticketId: step.ticketId ?? null,
      actor: step.actor,
      stage: step.stage,
      statement: step.statement,
      rationale: step.rationale,
      alternatives: step.alternatives ?? [],
      inputs: step.inputs ?? [],
      outputs: step.outputs ?? [],
      confidence: step.confidence ?? null,
      costCents: step.costCents ?? null,
      auditEventId: step.auditEventId ?? null,
    })
  } catch {
    // provenance is a layer over the audit log; never let it break the step
  }
}
