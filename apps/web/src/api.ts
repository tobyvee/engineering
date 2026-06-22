import type { AuditEvent, HierarchyNode, Ticket } from "@eng/core"

/** A human gate awaiting sign-off (derived server-side from the audit log). */
export interface PendingApproval {
  epicId: string
  kind: string
  at: string
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json() as Promise<T>
}

/** Typed client over the Hono API. Shapes come straight from `@eng/core`. */
export const api = {
  health: () => getJson<{ ok: boolean }>("/health"),
  tickets: () => getJson<{ tickets: Ticket[] }>("/api/tickets").then((r) => r.tickets),
  approvals: () =>
    getJson<{ approvals: PendingApproval[] }>("/api/approvals").then((r) => r.approvals),
  audit: () => getJson<{ events: AuditEvent[] }>("/api/audit").then((r) => r.events),
  goals: () => getJson<{ goals: HierarchyNode[] }>("/api/goals").then((r) => r.goals),
  epics: (goalId?: string) =>
    getJson<{ epics: HierarchyNode[] }>(
      goalId ? `/api/epics?goalId=${encodeURIComponent(goalId)}` : "/api/epics",
    ).then((r) => r.epics),
  createGoal: (title: string) => postJson<{ goal: HierarchyNode }>("/api/goals", { title }),
  createEpic: (title: string, goalId?: string) =>
    postJson<{ epic: HierarchyNode }>("/api/epics", { title, goalId }),
  createTicket: (title: string, epicId?: string) =>
    postJson<{ ticket: Ticket }>("/api/tickets", { title, epicId }),
  shapeEpic: (id: string) => postJson<{ shaping: boolean }>(`/api/epics/${id}/shape`),
  artifacts: (id: string) =>
    getJson<{ artifacts: { stage: string; title: string; content: string }[] }>(
      `/api/epics/${id}/artifacts`,
    ).then((r) => r.artifacts),
  decomposeEpic: (id: string) => postJson<{ decomposing: boolean }>(`/api/epics/${id}/decompose`),
  approveRoadmap: (id: string) =>
    postJson<{ signaled: boolean }>(`/api/epics/${id}/approve-roadmap`),
  startTicket: (id: string) => postJson<{ started: boolean }>(`/api/tickets/${id}/start`),
  approve: (id: string, gate: "merge" | "deploy") =>
    postJson<{ signaled: boolean }>(`/api/tickets/${id}/approve`, { gate }),
}
