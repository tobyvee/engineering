import { z } from "zod"

/**
 * Domain schemas — the single source of truth shared by `server` and `web`.
 *
 * Work hierarchy: Mission → Goal/Initiative → Epic → Ticket. Every item carries its parent id, so
 * goal traceability (invariant #1) is structural rather than optional: you cannot construct a valid
 * ticket without an epic, an epic without a goal, or a goal without a mission.
 */

export const RoleId = z.enum([
  "pm",
  "ux_design",
  "lead_architect",
  "lead_system_design",
  "lead_engineer",
  "staff_engineer",
  "qa_test",
])
export type RoleId = z.infer<typeof RoleId>

/** Macro lifecycle stages — states with human gates, not a linear batch DAG. */
export const LifecycleStage = z.enum([
  "discovery",
  "design",
  "architecture",
  "implementation",
  "review",
  "ship",
])
export type LifecycleStage = z.infer<typeof LifecycleStage>

/** Ticket delivery states. */
export const TicketStatus = z.enum([
  "backlog",
  "planned",
  "in_progress",
  "in_review",
  "deploying",
  "blocked",
  "done",
])
export type TicketStatus = z.infer<typeof TicketStatus>

export const ApprovalKind = z.enum([
  "roadmap",
  "design_signoff",
  "architecture_decision",
  "pr_merge",
  "deploy",
])
export type ApprovalKind = z.infer<typeof ApprovalKind>

export const ApprovalStatus = z.enum(["pending", "approved", "rejected"])
export type ApprovalStatus = z.infer<typeof ApprovalStatus>

const id = z.string()
const timestamp = z.string() // ISO-8601

export const Mission = z.object({
  id,
  unitId: id,
  title: z.string(),
  statement: z.string(),
  createdAt: timestamp,
})
export type Mission = z.infer<typeof Mission>

export const Goal = z.object({
  id,
  missionId: id,
  title: z.string(),
  description: z.string(),
  createdAt: timestamp,
})
export type Goal = z.infer<typeof Goal>

export const Epic = z.object({
  id,
  goalId: id,
  title: z.string(),
  description: z.string(),
  createdAt: timestamp,
})
export type Epic = z.infer<typeof Epic>

export const Ticket = z.object({
  id,
  epicId: id,
  title: z.string(),
  description: z.string(),
  status: TicketStatus,
  stage: LifecycleStage,
  assigneeRole: RoleId.nullable(),
  acceptanceCriteria: z.array(z.string()),
  createdAt: timestamp,
  updatedAt: timestamp,
})
export type Ticket = z.infer<typeof Ticket>

/** Budget scope: a single role or the whole unit. Enforced centrally (invariant #3). */
export const BudgetScope = z.union([RoleId, z.literal("unit")])
export type BudgetScope = z.infer<typeof BudgetScope>

export const Budget = z.object({
  scope: BudgetScope,
  limitCents: z.number().int().nonnegative(),
  spentCents: z.number().int().nonnegative(),
})
export type Budget = z.infer<typeof Budget>

export const Approval = z.object({
  id,
  kind: ApprovalKind,
  ticketId: id.nullable(),
  epicId: id.nullable(),
  requestedByRole: RoleId,
  status: ApprovalStatus,
  decidedBy: z.string().nullable(),
  createdAt: timestamp,
  decidedAt: timestamp.nullable(),
})
export type Approval = z.infer<typeof Approval>

/** Append-only audit record (invariant #2). */
export const AuditEvent = z.object({
  id,
  at: timestamp,
  actor: z.union([RoleId, z.literal("human"), z.literal("system")]),
  kind: z.string(), // "tool_call" | "decision" | "state_change" | "approval"
  ticketId: id.nullable(),
  payload: z.record(z.string(), z.unknown()),
})
export type AuditEvent = z.infer<typeof AuditEvent>
