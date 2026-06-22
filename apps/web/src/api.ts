import type { Approval, AuditEvent, Ticket } from "@eng/core"

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json() as Promise<T>
}

/** Typed client over the Hono read-views. Shapes come straight from `@eng/core`. */
export const api = {
  health: () => getJson<{ ok: boolean }>("/health"),
  tickets: () => getJson<{ tickets: Ticket[] }>("/api/tickets").then((r) => r.tickets),
  approvals: () => getJson<{ approvals: Approval[] }>("/api/approvals").then((r) => r.approvals),
  audit: () => getJson<{ events: AuditEvent[] }>("/api/audit").then((r) => r.events),
}
