import { createWorker } from "@eng/agents"
import {
  type DeliveryAdapter,
  type LifecycleStage,
  type PullRequestRef,
  ROLES,
  type RoleId,
  type TicketStatus,
} from "@eng/core"
import { appendAudit, getTicket, getTraceContext, setTicketStatus } from "@eng/db"
import { createGitHubDelivery } from "@eng/integrations"

/**
 * Activities are the side-effecting steps the durable workflow calls. They run in the normal Node
 * runtime (DB writes, agent runs, GitHub calls, audit appends) and — unlike workflow code — need
 * not be deterministic.
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

// --- Delivery (GitHub) -------------------------------------------------------

function deliveryFromEnv(): DeliveryAdapter | null {
  const token = process.env.GITHUB_TOKEN
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  if (!token || !owner || !repo) return null
  return createGitHubDelivery({ token, owner, repo, baseBranch: process.env.GITHUB_BASE_BRANCH })
}

const BASE_BRANCH = process.env.GITHUB_BASE_BRANCH ?? "main"

/** Open a branch + PR for the ticket's work. Returns null when GitHub isn't configured. */
export async function startDelivery(ticketId: string): Promise<PullRequestRef | null> {
  const delivery = deliveryFromEnv()
  if (!delivery) {
    await appendAudit({
      actor: "system",
      kind: "delivery_skipped",
      ticketId,
      payload: { reason: "GitHub not configured" },
    })
    return null
  }

  const branch = `ticket/${ticketId}`
  try {
    const ticket = await getTicket(ticketId)
    await delivery.createBranch(BASE_BRANCH, branch)
    const pr = await delivery.openPullRequest({
      branch,
      title: ticket?.title ?? `Ticket ${ticketId}`,
      body: `Automated delivery for ticket ${ticketId}.`,
    })
    await appendAudit({
      actor: "lead_engineer",
      kind: "pr_opened",
      ticketId,
      payload: { number: pr.number, url: pr.url, branch },
    })
    return pr
  } catch (err) {
    await appendAudit({
      actor: "system",
      kind: "delivery_error",
      ticketId,
      payload: { phase: "open", branch, error: String(err) },
    })
    return null
  }
}

/** Aggregate the PR's checks: failure > pending > success (empty = success). */
export async function checkDeliveryStatus(
  pr: PullRequestRef,
): Promise<"pending" | "success" | "failure"> {
  const delivery = deliveryFromEnv()
  if (!delivery) return "success"
  const checks = await delivery.getChecks(pr)
  if (checks.some((c) => c.state === "failure")) return "failure"
  if (checks.some((c) => c.state === "pending")) return "pending"
  return "success"
}

/** Merge the PR (best-effort — records merge_failed rather than throwing). */
export async function mergeDelivery(ticketId: string, pr: PullRequestRef): Promise<void> {
  const delivery = deliveryFromEnv()
  if (!delivery) return
  try {
    await delivery.merge(pr)
    await appendAudit({
      actor: "lead_engineer",
      kind: "pr_merged",
      ticketId,
      payload: { number: pr.number, url: pr.url },
    })
  } catch (err) {
    await appendAudit({
      actor: "system",
      kind: "merge_failed",
      ticketId,
      payload: { number: pr.number, error: String(err) },
    })
  }
}
