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
 * Ensure a parent Mission→Goal→Epic chain exists and return the epic id. Goal traceability
 * (invariant #1) means a ticket cannot exist without an epic, so this seeds the chain on first use.
 * Idempotent: reuses the existing epic if one is already present.
 */
export async function ensureSeedEpicId(): Promise<string> {
  const existing = await db.select().from(epics).limit(1)
  if (existing[0]) return existing[0].id

  const unit = firstOrThrow(
    await db.insert(units).values({ name: "Default Unit" }).returning(),
    "unit",
  )
  // Seed a budget per role so spend can be enforced centrally (invariant #3).
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
  const goal = firstOrThrow(
    await db
      .insert(goals)
      .values({
        missionId: mission.id,
        title: "Bootstrap the unit",
        description: "Stand up delivery.",
      })
      .returning(),
    "goal",
  )
  const epic = firstOrThrow(
    await db
      .insert(epics)
      .values({ goalId: goal.id, title: "Vertical slice", description: "First end-to-end flow." })
      .returning(),
    "epic",
  )
  return epic.id
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
