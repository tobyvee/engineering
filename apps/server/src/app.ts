import { createTicket, listAudit, listTickets } from "@eng/db"
import { Hono } from "hono"
import { approveTicket, startTicketLifecycle } from "./temporal/client"

/**
 * The HTTP API. GET routes are read views over append-only state. Mutations that affect agent work
 * go through Temporal: `/start` launches the durable workflow and `/approve` signals it — neither
 * flips a row directly.
 */
export const app = new Hono()

app.onError((err, c) => c.json({ error: String(err) }, 500))

app.get("/health", (c) => c.json({ ok: true }))

app.get("/api/tickets", async (c) => c.json({ tickets: await listTickets() }))
app.get("/api/audit", async (c) => c.json({ events: await listAudit() }))
app.get("/api/approvals", (c) => c.json({ approvals: [] }))

// Create a ticket (ensures the seed Mission→Goal→Epic exists, per traceability invariant #1).
app.post("/api/tickets", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string }
  const ticket = await createTicket({ title: body.title ?? "Demo ticket" })
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
