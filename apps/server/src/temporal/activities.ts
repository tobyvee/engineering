import type { LifecycleStage, TicketStatus } from "@eng/core"

/**
 * Activities are the side-effecting steps the durable workflow calls. They run in the normal Node
 * runtime (DB writes, agent runs, audit appends) and — unlike workflow code — need not be
 * deterministic.
 */
export async function transitionTicket(ticketId: string, status: TicketStatus): Promise<void> {
  // TODO: persist via @eng/db and append a `state_change` event to the audit log.
  console.log(`[activity] ticket ${ticketId} -> ${status}`)
}

export async function runAgentStep(ticketId: string, stage: LifecycleStage): Promise<void> {
  // TODO: resolve the role for `stage`, run an @eng/agents Worker within budget, capture audit.
  console.log(`[activity] agent step for ticket ${ticketId} @ ${stage}`)
}
