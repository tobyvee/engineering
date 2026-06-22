import type { Ticket, TicketStatus } from "./schema"

/** Issue-tracker boundary: GitHub Issues/Projects, Linear, or Jira behind one interface. */
export type NewTicket = Omit<Ticket, "id" | "createdAt" | "updatedAt">

export interface IssueTracker {
  createTicket(input: NewTicket): Promise<Ticket>
  get(id: string): Promise<Ticket | null>
  transition(id: string, status: TicketStatus): Promise<Ticket>
  list(filter?: { status?: TicketStatus }): Promise<Ticket[]>
}
