import {
  type AuditEvent,
  type NewAuditEvent,
  type NewTicket,
  ROLES,
  type Ticket,
  type TicketStatus,
} from "@eng/core"
import { desc, eq, sql } from "drizzle-orm"
import { db } from "./client"
import { auditLog, budgets, epics, goals, missions, tickets, units } from "./schema"

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

/** Remaining budget (cents) for a scope (role id or "unit"); null if no budget row exists. */
export async function getBudgetRemaining(scope: string): Promise<number | null> {
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
