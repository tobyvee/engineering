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

// Goal hierarchy authoring (through the persistence port, so the backend is swappable). Lets the
// human/PM decompose work under multiple goals + epics; tickets then target a chosen epic.
app.get("/api/goals", async (c) => c.json({ goals: await persistence.hierarchy.listGoals() }))
app.post("/api/goals", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; description?: string }
  const goal = await persistence.hierarchy.createGoal({
    title: body.title ?? "Untitled goal",
    description: body.description,
  })
  return c.json({ goal }, 201)
})

app.get("/api/epics", async (c) =>
  c.json({ epics: await persistence.hierarchy.listEpics(c.req.query("goalId")) }),
)
app.post("/api/epics", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string
    description?: string
    goalId?: string
  }
  const epic = await persistence.hierarchy.createEpic({
    title: body.title ?? "Untitled epic",
    description: body.description,
    goalId: body.goalId,
  })
  return c.json({ epic }, 201)
})

// Create a ticket through the tracker under a chosen epic (or seed the default Mission→Goal→Epic
// chain when `epicId` is unset, per traceability invariant #1) and record it via the audit port.
app.post("/api/tickets", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; epicId?: string }
  const ticket = await persistence.tracker.createTicket({
    epicId: body.epicId ?? "",
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
