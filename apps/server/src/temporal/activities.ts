import { createWorker } from "@eng/agents"
import { type LifecycleStage, ROLES, type RoleId, type TicketStatus } from "@eng/core"
import { appendAudit, getTicket, getTraceContext, setTicketStatus } from "@eng/db"

/**
 * Activities are the side-effecting steps the durable workflow calls. They run in the normal Node
 * runtime (DB writes, agent runs, audit appends) and — unlike workflow code — need not be
 * deterministic.
 */
export async function transitionTicket(ticketId: string, status: TicketStatus): Promise<void> {
  await setTicketStatus(ticketId, status)
}

/** Pick the role that primarily owns a lifecycle stage. */
function roleForStage(stage: LifecycleStage): RoleId {
  for (const role of Object.values(ROLES)) {
    if (role.ownsStages.includes(stage)) return role.id
  }
  return "staff_engineer"
}

export async function runAgentStep(ticketId: string, stage: LifecycleStage): Promise<void> {
  const roleId = roleForStage(stage)
  const role = ROLES[roleId]

  try {
    const [ticket, goalContext] = await Promise.all([
      getTicket(ticketId),
      getTraceContext(ticketId),
    ])

    const result = await createWorker().run({
      role: roleId,
      systemPrompt: role.systemPrompt,
      tools: role.tools,
      goalContext,
      task: ticket
        ? `Advance the "${stage}" stage of ticket "${ticket.title}": ${ticket.description || "(no description provided)"}.`
        : `Advance the "${stage}" stage of ticket ${ticketId}.`,
      budgetCentsRemaining: role.monthlyBudgetCents,
    })

    await appendAudit({
      actor: roleId,
      kind: "agent_step",
      ticketId,
      payload: {
        stage,
        summary: result.summary,
        costCents: result.costCents,
        stoppedReason: result.stoppedReason,
      },
    })
  } catch (err) {
    // The durable workflow must still progress even if the agent runtime is unavailable
    // (e.g. no credentials configured) — record the skip instead of failing the activity.
    await appendAudit({
      actor: "system",
      kind: "agent_step_skipped",
      ticketId,
      payload: { stage, role: roleId, error: String(err) },
    })
  }
}
