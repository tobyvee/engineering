import type { LifecycleStage, TicketStatus } from "@eng/core"
import { appendAudit, setTicketStatus } from "@eng/db"

/**
 * Activities are the side-effecting steps the durable workflow calls. They run in the normal Node
 * runtime (DB writes, agent runs, audit appends) and — unlike workflow code — need not be
 * deterministic.
 */
export async function transitionTicket(ticketId: string, status: TicketStatus): Promise<void> {
  await setTicketStatus(ticketId, status)
}

export async function runAgentStep(ticketId: string, stage: LifecycleStage): Promise<void> {
  // TODO: resolve the role for `stage`, run an @eng/agents Worker within budget. For now, record
  // that the step ran so the audit log reflects the agent stage.
  await appendAudit({ actor: "system", kind: "agent_step", ticketId, payload: { stage } })
}
