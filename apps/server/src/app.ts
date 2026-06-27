import { listBudgets, listPendingApprovals, resolveApproval } from "@eng/db"
import { Hono } from "hono"
import { type AppEnv, authMiddleware } from "./auth"
import { persistenceFromEnv } from "./persistence"
import { artifactPath, SHAPING_STAGES } from "./shaping"
import {
  approveRoadmap,
  approveTicket,
  startEpicDecomposition,
  startEpicShaping,
  startTicketLifecycle,
} from "./temporal/client"

/**
 * The HTTP API. GET routes are read views over append-only state. Mutations that affect agent work
 * go through Temporal: `/start` launches the durable workflow and `/approve` signals it — neither
 * flips a row directly. Tickets + audit go through the persistence layer (PERSISTENCE_BACKEND).
 */
const persistence = persistenceFromEnv()

export const app = new Hono<AppEnv>()

app.onError((err, c) => c.json({ error: String(err) }, 500))

app.get("/health", (c) => c.json({ ok: true }))

// Auth gate (ENG-004): GET read views stay open; mutating /api requests require a Bearer token when
// API_AUTH_TOKEN is set. The resolved principal is recorded on approval events below.
app.use("/api/*", authMiddleware())

app.get("/api/tickets", async (c) => c.json({ tickets: await persistence.tracker.list() }))
app.get("/api/audit", async (c) => c.json({ events: await persistence.audit.query() }))
// Pending human gates as first-class records (ENG-006): roadmap · pr_merge · deploy.
app.get("/api/approvals", async (c) => c.json({ approvals: await listPendingApprovals() }))
// Per-role budget/cost view for the dashboard (ENG-010).
app.get("/api/budgets", async (c) => c.json({ budgets: await listBudgets() }))

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

// Upstream shaping: PM discovery → UX design → architecture agents draft artifacts for the epic.
app.post("/api/epics/:id/shape", async (c) => {
  const id = c.req.param("id")
  await startEpicShaping(id)
  return c.json({ epicId: id, shaping: true })
})

// The shaping artifacts drafted for an epic (a read view over the KB).
app.get("/api/epics/:id/artifacts", async (c) => {
  const id = c.req.param("id")
  const artifacts = []
  for (const stage of SHAPING_STAGES) {
    const content = await persistence.knowledge.read(artifactPath(id, stage.key))
    if (content) artifacts.push({ stage: stage.key, title: stage.title, content })
  }
  return c.json({ artifacts })
})

// Agent-driven decomposition: the Lead Engineer breaks the epic into backlog tickets — but behind a
// roadmap sign-off gate (the workflow blocks until the human approves the plan, below).
app.post("/api/epics/:id/decompose", async (c) => {
  const id = c.req.param("id")
  await startEpicDecomposition(id)
  return c.json({ epicId: id, decomposing: true })
})

// Roadmap sign-off (invariant #4): release the gate so decomposition proceeds.
app.post("/api/epics/:id/approve-roadmap", async (c) => {
  const id = c.req.param("id")
  const signaled = await approveRoadmap(id)
  const by = c.get("actor")
  // Resolve the first-class approval record (ENG-006) + audit who released the gate (ENG-004).
  await resolveApproval({ kind: "roadmap", epicId: id, decidedBy: by })
  await persistence.audit.append({
    actor: "human",
    kind: "approval_decided",
    ticketId: null,
    payload: { epicId: id, gate: "roadmap", by, signaled },
  })
  return c.json({ epicId: id, gate: "roadmap", signaled, by })
})

// Create a ticket through the tracker under a chosen epic (or seed the default Mission→Goal→Epic
// chain when `epicId` is unset, per traceability invariant #1) and record it via the audit port.
app.post("/api/tickets", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string
    epicId?: string
    description?: string
    acceptanceCriteria?: string[]
  }
  const ticket = await persistence.tracker.createTicket({
    epicId: body.epicId ?? "",
    title: body.title ?? "Demo ticket",
    description: body.description ?? "",
    status: "backlog",
    stage: "implementation",
    assigneeRole: null,
    acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria : [],
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
  const by = c.get("actor")
  // Resolve the first-class approval record (ENG-006) + audit who released the gate (ENG-004).
  await resolveApproval({
    kind: gate === "deploy" ? "deploy" : "pr_merge",
    ticketId: id,
    decidedBy: by,
  })
  await persistence.audit.append({
    actor: "human",
    kind: "approval_decided",
    ticketId: id,
    payload: { gate, by },
  })
  return c.json({ ticketId: id, gate, signaled: true, by })
})
