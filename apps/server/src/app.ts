import { Hono } from "hono"

/**
 * The HTTP API. The dashboard consumes these read views over append-only state; mutations that
 * affect agent work go through Temporal (e.g. the approval endpoint signals the durable workflow,
 * it does not flip a row directly).
 */
export const app = new Hono()

app.get("/health", (c) => c.json({ ok: true }))

app.get("/api/tickets", (c) => c.json({ tickets: [] }))
app.get("/api/approvals", (c) => c.json({ approvals: [] }))
app.get("/api/audit", (c) => c.json({ events: [] }))

// Human approval gate (invariant #4): resolves the durable wait in the ticket lifecycle workflow.
app.post("/api/tickets/:id/approve", async (c) => {
  const id = c.req.param("id")
  // TODO: createTemporalClient() then
  //   client.workflow.getHandle(`ticket-${id}`).signal(approveSignal, true)
  return c.json({ ticketId: id, signaled: true })
})
