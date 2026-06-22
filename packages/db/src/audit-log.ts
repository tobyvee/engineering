import type { AuditEvent, AuditLog, NewAuditEvent } from "@eng/core"
import { appendAudit, listAudit } from "./repo"

/** AuditLog backed by Postgres (the append-only `audit_log` table). */
export class DbAuditLog implements AuditLog {
  append(event: NewAuditEvent): Promise<AuditEvent> {
    return appendAudit(event)
  }

  async query(filter?: { ticketId?: string }): Promise<AuditEvent[]> {
    const events = await listAudit()
    return filter?.ticketId ? events.filter((e) => e.ticketId === filter.ticketId) : events
  }
}
