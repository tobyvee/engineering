import type { AuditEvent, NewAuditEvent, Ticket, TicketStatus } from "@eng/core"
import { desc, eq } from "drizzle-orm"
import { db } from "./client"
import { auditLog, epics, goals, missions, tickets, units } from "./schema"

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

export async function createTicket(input: {
  title: string
  description?: string
}): Promise<Ticket> {
  const epicId = await ensureSeedEpicId()
  const ticket = firstOrThrow(
    await db
      .insert(tickets)
      .values({ epicId, title: input.title, description: input.description ?? "" })
      .returning(),
    "ticket",
  )
  await appendAudit({ actor: "system", kind: "ticket_created", ticketId: ticket.id, payload: {} })
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

export async function setTicketStatus(id: string, status: TicketStatus): Promise<void> {
  await db.update(tickets).set({ status, updatedAt: new Date() }).where(eq(tickets.id, id))
  await appendAudit({ actor: "system", kind: "state_change", ticketId: id, payload: { status } })
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
