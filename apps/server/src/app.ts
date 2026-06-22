import { Hono } from "hono"
import { persistenceFromEnv } from "./persistence"
import { approveTicket, startTicketLifecycle } from "./temporal/client"

/**
 * The HTTP API. GET routes are read views over append-only state. Mutations that affect agent work
 * go through Temporal: `/start` launches the durable workflow and `/approve` signals it — neither
 * flips a row directly. Tickets + audit go through the persistence layer (PERSISTENCE_BACKEND).
 */
const persistence = persistenceFromEnv()

export const app = new Hono()

app.onError((err, c) => c.json({ error: String(err) }, 500))

app.get("/health", (c) => c.json({ ok: true }))

app.get("/api/tickets", async (c) => c.json({ tickets: await persistence.tracker.list() }))
app.get("/api/audit", async (c) => c.json({ events: await persistence.audit.query() }))
app.get("/api/approvals", (c) => c.json({ approvals: [] }))

// Create a ticket through the tracker (the DB backend seeds the Mission→Goal→Epic chain when the
// epic is unset, per traceability invariant #1) and record it via the audit port.
app.post("/api/tickets", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string }
  const ticket = await persistence.tracker.createTicket({
    epicId: "",
    title: body.title ?? "Demo ticket",
    description: "",
    status: "backlog",
    stage: "implementation",
    assigneeRole: null,
    acceptanceCriteria: [],
  })
  await persistence.audit.append({
    actor: "system",
    kind: "ticket_created",
    ticketId: ticket.id,
    payload: {},
  })
  return c.json({ ticket }, 201)
})

// Start the durable lifecycle workflow for a ticket.
app.post("/api/tickets/:id/start", async (c) => {
  const id = c.req.param("id")
  await startTicketLifecycle(id)
  return c.json({ ticketId: id, started: true })
})

// Human approval gates (invariant #4): release a durable wait. `gate` selects which one —
// "merge" (the review/merge gate, default) or "deploy" (the ship gate).
app.post("/api/tickets/:id/approve", async (c) => {
  const id = c.req.param("id")
  const body = (await c.req.json().catch(() => ({}))) as { gate?: "merge" | "deploy" }
  const gate = body.gate === "deploy" ? "deploy" : "merge"
  await approveTicket(id, gate)
  return c.json({ ticketId: id, gate, signaled: true })
})
