import type { AuditEvent } from "./schema"

/**
 * Append-only (invariant #2): no update, no delete. The dashboard is a read view over this log,
 * so history is never mutated.
 */
export type NewAuditEvent = Omit<AuditEvent, "id" | "at">

export interface AuditLog {
  append(event: NewAuditEvent): Promise<AuditEvent>
  query(filter?: { ticketId?: string }): Promise<AuditEvent[]>
}
