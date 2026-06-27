import {
  type Approval,
  type ApprovalKind,
  type AuditEvent,
  type NewAuditEvent,
  type NewTicket,
  periodExpired,
  ROLES,
  type RoleId,
  type Ticket,
  type TicketStatus,
} from "@eng/core"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "./client"
import { approvals, auditLog, budgets, epics, goals, missions, tickets, units } from "./schema"

function firstOrThrow<T>(rows: T[], what: string): T {
  const row = rows[0]
  if (!row) throw new Error(`expected to create ${what}`)
  return row
}

function toTicket(row: typeof tickets.$inferSelect): Ticket {
  return {
    id: row.id,
    epicId: row.epicId,
    title: row.title,
    description: row.description,
    status: row.status,
    stage: row.stage,
    assigneeRole: row.assigneeRole,
    acceptanceCriteria: row.acceptanceCriteria,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toAudit(row: typeof auditLog.$inferSelect): AuditEvent {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor as AuditEvent["actor"],
    kind: row.kind,
    ticketId: row.ticketId,
    payload: row.payload,
  }
}

/**
 * Ensure the unit (with per-role budgets, invariant #3) and mission exist; return the mission id.
 * Idempotent: reuses the existing mission. The root every goal hangs off.
 */
async function ensureUnitMission(): Promise<string> {
  const existing = (await db.select().from(missions).limit(1))[0]
  if (existing) return existing.id

  const unit = firstOrThrow(
    await db.insert(units).values({ name: "Default Unit" }).returning(),
    "unit",
  )
  await db.insert(budgets).values(
    Object.values(ROLES).map((role) => ({
      unitId: unit.id,
      scope: role.id,
      limitCents: role.monthlyBudgetCents,
      spentCents: 0,
    })),
  )
  const mission = firstOrThrow(
    await db
      .insert(missions)
      .values({ unitId: unit.id, title: "Deliver the product", statement: "Ship value to users." })
      .returning(),
    "mission",
  )
  return mission.id
}

/** Ensure a default goal exists under the mission; return its id (the fallback epic parent). */
async function ensureDefaultGoalId(): Promise<string> {
  const existing = (await db.select().from(goals).limit(1))[0]
  if (existing) return existing.id
  const missionId = await ensureUnitMission()
  const goal = firstOrThrow(
    await db
      .insert(goals)
      .values({ missionId, title: "Bootstrap the unit", description: "Stand up delivery." })
      .returning(),
    "goal",
  )
  return goal.id
}

/**
 * Ensure a parent Mission→Goal→Epic chain exists and return the epic id. Goal traceability
 * (invariant #1) means a ticket cannot exist without an epic, so this seeds the chain on first use.
 * Idempotent: reuses the existing epic if one is already present.
 */
export async function ensureSeedEpicId(): Promise<string> {
  const existing = (await db.select().from(epics).limit(1))[0]
  if (existing) return existing.id
  const goalId = await ensureDefaultGoalId()
  const epic = firstOrThrow(
    await db
      .insert(epics)
      .values({ goalId, title: "Vertical slice", description: "First end-to-end flow." })
      .returning(),
    "epic",
  )
  return epic.id
}

/** List goals (newest first) — for authoring tickets/epics under a chosen initiative. */
export async function listGoals(): Promise<{ id: string; title: string }[]> {
  return db.select({ id: goals.id, title: goals.title }).from(goals).orderBy(desc(goals.createdAt))
}

/** Author a goal under the mission (seeds the unit/mission on first use). */
export async function createGoal(input: {
  title: string
  description?: string
}): Promise<{ id: string; title: string }> {
  const missionId = await ensureUnitMission()
  const goal = firstOrThrow(
    await db
      .insert(goals)
      .values({ missionId, title: input.title, description: input.description ?? "" })
      .returning(),
    "goal",
  )
  return { id: goal.id, title: goal.title }
}

/** List epics (newest first), optionally scoped to a goal. */
export async function listEpics(goalId?: string): Promise<{ id: string; title: string }[]> {
  return db
    .select({ id: epics.id, title: epics.title })
    .from(epics)
    .where(goalId ? eq(epics.goalId, goalId) : undefined)
    .orderBy(desc(epics.createdAt))
}

/** Author an epic under a goal (defaults to the seeded goal when `goalId` is omitted). */
export async function createEpic(input: {
  title: string
  description?: string
  goalId?: string
}): Promise<{ id: string; title: string }> {
  const goalId = input.goalId || (await ensureDefaultGoalId())
  const epic = firstOrThrow(
    await db
      .insert(epics)
      .values({ goalId, title: input.title, description: input.description ?? "" })
      .returning(),
    "epic",
  )
  return { id: epic.id, title: epic.title }
}

/** Insert a fully-specified ticket (all fields). Used by the IssueTracker. */
export async function insertTicket(input: NewTicket): Promise<Ticket> {
  const ticket = firstOrThrow(
    await db
      .insert(tickets)
      .values({
        epicId: input.epicId,
        title: input.title,
        description: input.description,
        status: input.status,
        stage: input.stage,
        assigneeRole: input.assigneeRole,
        acceptanceCriteria: input.acceptanceCriteria,
      })
      .returning(),
    "ticket",
  )
  return toTicket(ticket)
}

export async function listTickets(): Promise<Ticket[]> {
  const rows = await db.select().from(tickets).orderBy(desc(tickets.createdAt))
  return rows.map(toTicket)
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const row = (await db.select().from(tickets).where(eq(tickets.id, id)).limit(1))[0]
  return row ? toTicket(row) : null
}

/**
 * Resolve a ticket's full traceability chain (mission → goal → epic → ticket) as a prompt-ready
 * string. This is the "why" injected into every agent session (invariant #1).
 */
export async function getTraceContext(ticketId: string): Promise<string> {
  const row = (
    await db
      .select({
        ticketTitle: tickets.title,
        epicTitle: epics.title,
        goalTitle: goals.title,
        goalDescription: goals.description,
        missionTitle: missions.title,
        missionStatement: missions.statement,
      })
      .from(tickets)
      .innerJoin(epics, eq(tickets.epicId, epics.id))
      .innerJoin(goals, eq(epics.goalId, goals.id))
      .innerJoin(missions, eq(goals.missionId, missions.id))
      .where(eq(tickets.id, ticketId))
      .limit(1)
  )[0]

  if (!row) return `Ticket ${ticketId} (no trace context found).`
  return [
    `Mission: ${row.missionTitle} — ${row.missionStatement}`,
    `Goal: ${row.goalTitle} — ${row.goalDescription}`,
    `Epic: ${row.epicTitle}`,
    `Ticket: ${row.ticketTitle}`,
  ].join("\n")
}

/**
 * The mission → goal → epic context for an epic (its own description included) — the "why" handed to
 * the Lead Engineer agent when decomposing the epic into tickets.
 */
export async function getEpicContext(epicId: string): Promise<string> {
  const row = (
    await db
      .select({
        epicTitle: epics.title,
        epicDescription: epics.description,
        goalTitle: goals.title,
        goalDescription: goals.description,
        missionTitle: missions.title,
        missionStatement: missions.statement,
      })
      .from(epics)
      .innerJoin(goals, eq(epics.goalId, goals.id))
      .innerJoin(missions, eq(goals.missionId, missions.id))
      .where(eq(epics.id, epicId))
      .limit(1)
  )[0]

  if (!row) return `Epic ${epicId} (no context found).`
  return [
    `Mission: ${row.missionTitle} — ${row.missionStatement}`,
    `Goal: ${row.goalTitle} — ${row.goalDescription}`,
    `Epic: ${row.epicTitle} — ${row.epicDescription}`,
  ].join("\n")
}

/** Update only — audit is appended by the orchestrator through the AuditLog port. */
export async function setTicketStatus(id: string, status: TicketStatus): Promise<void> {
  await db.update(tickets).set({ status, updatedAt: new Date() }).where(eq(tickets.id, id))
}

/** Append-only (invariant #2): inserts only. */
export async function appendAudit(event: NewAuditEvent): Promise<AuditEvent> {
  const row = firstOrThrow(
    await db
      .insert(auditLog)
      .values({
        actor: event.actor,
        kind: event.kind,
        ticketId: event.ticketId,
        payload: event.payload,
      })
      .returning(),
    "audit event",
  )
  return toAudit(row)
}

export async function listAudit(): Promise<AuditEvent[]> {
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.at))
  return rows.map(toAudit)
}

/** Reset a scope's spend if its budget window has rolled over (ENG-007). Lazy — called on read/reserve
 *  so `monthlyBudgetCents` is a real monthly allowance, not a lifetime total that only grows. */
async function rolloverIfExpired(scope: string): Promise<void> {
  const row = (
    await db
      .select({ periodStart: budgets.periodStart })
      .from(budgets)
      .where(eq(budgets.scope, scope))
      .limit(1)
  )[0]
  if (row && periodExpired(row.periodStart.toISOString(), new Date())) {
    await db
      .update(budgets)
      .set({ spentCents: 0, periodStart: new Date() })
      .where(eq(budgets.scope, scope))
  }
}

/** Remaining budget (cents) for a scope (role id or "unit"); null if no budget row exists. */
export async function getBudgetRemaining(scope: string): Promise<number | null> {
  await rolloverIfExpired(scope)
  const row = (
    await db
      .select({ limitCents: budgets.limitCents, spentCents: budgets.spentCents })
      .from(budgets)
      .where(eq(budgets.scope, scope))
      .limit(1)
  )[0]
  return row ? Math.max(0, row.limitCents - row.spentCents) : null
}

/** Record agent spend against a scope's budget (invariant #3). Rounds to whole cents. */
export async function addSpend(scope: string, cents: number): Promise<void> {
  const c = Math.round(cents)
  if (c <= 0) return
  await db
    .update(budgets)
    .set({ spentCents: sql`${budgets.spentCents} + ${c}` })
    .where(eq(budgets.scope, scope))
}

/**
 * Atomically reserve `cents` against a scope's budget (ENG-007). Returns the held amount on success,
 * `null` if the reservation would exceed the limit (caller skips the run), or `0` when no budget row
 * exists (run proceeds unmetered). The conditional UPDATE serializes concurrent reservations so they
 * cannot jointly exceed the limit — closing the read-then-spend TOCTOU.
 */
export async function reserveBudget(scope: string, cents: number): Promise<number | null> {
  await rolloverIfExpired(scope)
  const c = Math.max(0, Math.round(cents))
  const exists = (
    await db.select({ id: budgets.id }).from(budgets).where(eq(budgets.scope, scope)).limit(1)
  )[0]
  if (!exists) return 0
  if (c === 0) return 0
  const updated = await db
    .update(budgets)
    .set({ spentCents: sql`${budgets.spentCents} + ${c}` })
    .where(
      and(eq(budgets.scope, scope), sql`${budgets.spentCents} + ${c} <= ${budgets.limitCents}`),
    )
    .returning({ id: budgets.id })
  return updated.length > 0 ? c : null
}

/** Settle a reservation to actual spend (ENG-007): adjust the held amount by (actual − held), ≥ 0. */
export async function reconcileSpend(
  scope: string,
  heldCents: number,
  actualCents: number,
): Promise<void> {
  const delta = Math.round(actualCents) - Math.round(heldCents)
  if (delta === 0) return
  await db
    .update(budgets)
    .set({ spentCents: sql`GREATEST(0, ${budgets.spentCents} + ${delta})` })
    .where(eq(budgets.scope, scope))
}

// --- Approvals (first-class gate records, ENG-006) ---------------------------

function toApproval(row: typeof approvals.$inferSelect): Approval {
  return {
    id: row.id,
    kind: row.kind,
    ticketId: row.ticketId,
    epicId: row.epicId,
    requestedByRole: row.requestedByRole,
    status: row.status,
    decidedBy: row.decidedBy,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  }
}

/** Create a pending approval when a gate is reached (ENG-006). */
export async function createApproval(input: {
  kind: ApprovalKind
  ticketId?: string | null
  epicId?: string | null
  requestedByRole: RoleId
}): Promise<Approval> {
  const row = firstOrThrow(
    await db
      .insert(approvals)
      .values({
        kind: input.kind,
        ticketId: input.ticketId ?? null,
        epicId: input.epicId ?? null,
        requestedByRole: input.requestedByRole,
      })
      .returning(),
    "approval",
  )
  return toApproval(row)
}

/** Resolve the matching pending approval, recording who decided it (ENG-006). */
export async function resolveApproval(input: {
  kind: ApprovalKind
  ticketId?: string | null
  epicId?: string | null
  decidedBy: string
  status?: "approved" | "rejected"
}): Promise<void> {
  const conds = [eq(approvals.kind, input.kind), eq(approvals.status, "pending")]
  if (input.ticketId) conds.push(eq(approvals.ticketId, input.ticketId))
  if (input.epicId) conds.push(eq(approvals.epicId, input.epicId))
  await db
    .update(approvals)
    .set({ status: input.status ?? "approved", decidedBy: input.decidedBy, decidedAt: new Date() })
    .where(and(...conds))
}

/** Pending approvals across all gate kinds (roadmap · merge · deploy), newest first (ENG-006). */
export async function listPendingApprovals(): Promise<Approval[]> {
  const rows = await db
    .select()
    .from(approvals)
    .where(eq(approvals.status, "pending"))
    .orderBy(desc(approvals.createdAt))
  return rows.map(toApproval)
}

/** Per-scope budgets with remaining, for the dashboard (ENG-010). */
export interface BudgetSummary {
  scope: string
  limitCents: number
  spentCents: number
  remainingCents: number
}

export async function listBudgets(): Promise<BudgetSummary[]> {
  const rows = await db
    .select({
      scope: budgets.scope,
      limitCents: budgets.limitCents,
      spentCents: budgets.spentCents,
    })
    .from(budgets)
    .orderBy(budgets.scope)
  return rows.map((r) => ({ ...r, remainingCents: Math.max(0, r.limitCents - r.spentCents) }))
}
