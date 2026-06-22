import type { IssueTracker, NewTicket, Ticket, TicketStatus } from "@eng/core"
import { ensureSeedEpicId, getTicket, insertTicket, listTickets, setTicketStatus } from "./repo"

/**
 * IssueTracker backed by our Postgres store — the source of truth for tickets. Conforms the repo to
 * core's `IssueTracker` boundary (invariant #5). A GitHub-Issues / Linear / Jira tracker would be an
 * alternative implementation behind the same interface.
 */
export class DbIssueTracker implements IssueTracker {
  async createTicket(input: NewTicket): Promise<Ticket> {
    const epicId = input.epicId || (await ensureSeedEpicId())
    return insertTicket({ ...input, epicId })
  }

  get(id: string): Promise<Ticket | null> {
    return getTicket(id)
  }

  async transition(id: string, status: TicketStatus): Promise<Ticket> {
    await setTicketStatus(id, status)
    const ticket = await getTicket(id)
    if (!ticket) throw new Error(`ticket ${id} not found`)
    return ticket
  }

  async list(filter?: { status?: TicketStatus }): Promise<Ticket[]> {
    const tickets = await listTickets()
    return filter?.status ? tickets.filter((t) => t.status === filter.status) : tickets
  }
}
