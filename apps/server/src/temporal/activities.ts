import { assess, proposeFileChanges } from "@eng/agents"
import {
  type DeliveryAdapter,
  type DeployState,
  type PullRequestRef,
  ROLES,
  type TicketStatus,
} from "@eng/core"
import {
  addSpend,
  appendAudit,
  getBudgetRemaining,
  getTicket,
  getTraceContext,
  listTickets,
  setTicketStatus,
} from "@eng/db"
import { createGitHubDelivery } from "@eng/integrations"
import { startTicketLifecycle } from "./client"

/**
 * Activities are the side-effecting steps the durable workflow calls. They run in the normal Node
 * runtime (DB writes, agent runs, GitHub calls, audit appends) and — unlike workflow code — need
 * not be deterministic.
 */
export async function transitionTicket(ticketId: string, status: TicketStatus): Promise<void> {
  await setTicketStatus(ticketId, status)
}

/** Start the lifecycle for any `backlog` tickets (idempotent). Driven by the heartbeat schedule. */
export async function pickUpBacklog(): Promise<number> {
  const backlog = (await listTickets()).filter((t) => t.status === "backlog")
  for (const ticket of backlog) {
    await startTicketLifecycle(ticket.id)
  }
  return backlog.length
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
const DEPLOY_WORKFLOW = process.env.GITHUB_DEPLOY_WORKFLOW
const DEPLOY_REF = process.env.GITHUB_DEPLOY_REF ?? BASE_BRANCH

/**
 * The implementation step: a Staff Engineer agent writes the code, then — if GitHub is configured —
 * the changes are committed to a ticket branch and a PR is opened. Returns the PR (for the later
 * merge) or null. A no-op delivery when GitHub isn't set, so the lifecycle still completes.
 */
export async function implementTicket(ticketId: string): Promise<PullRequestRef | null> {
  const role = ROLES.staff_engineer
  const [ticket, goalContext] = await Promise.all([getTicket(ticketId), getTraceContext(ticketId)])
  const title = ticket?.title ?? `Ticket ${ticketId}`

  // Central budget enforcement (invariant #3): remaining = limit − spent from the budgets table.
  const remaining = (await getBudgetRemaining(role.id)) ?? role.monthlyBudgetCents

  let proposed: Awaited<ReturnType<typeof proposeFileChanges>> | null = null
  try {
    proposed = await proposeFileChanges({
      role: role.id,
      systemPrompt: role.systemPrompt,
      goalContext,
      task: ticket
        ? `Implement ticket "${ticket.title}": ${ticket.description || "(no description provided)"}.`
        : `Implement ticket ${ticketId}.`,
      budgetCentsRemaining: remaining,
    })
    await addSpend(role.id, proposed.costCents)
    await appendAudit({
      actor: "staff_engineer",
      kind: "agent_step",
      ticketId,
      payload: {
        stage: "implementation",
        summary: proposed.summary,
        costCents: proposed.costCents,
        budgetRemaining: remaining,
        files: proposed.files.length,
      },
    })
  } catch (err) {
    await appendAudit({
      actor: "system",
      kind: "agent_step_skipped",
      ticketId,
      payload: { stage: "implementation", error: String(err) },
    })
  }

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
  if (!proposed || proposed.files.length === 0) {
    await appendAudit({
      actor: "system",
      kind: "delivery_skipped",
      ticketId,
      payload: { reason: "no file changes proposed" },
    })
    return null
  }

  const branch = `ticket/${ticketId}`
  try {
    await delivery.createBranch(BASE_BRANCH, branch)
    const commit = await delivery.commitFiles(branch, `feat: ${title}`, proposed.files)
    await appendAudit({
      actor: "staff_engineer",
      kind: "code_pushed",
      ticketId,
      payload: { branch, sha: commit.sha, files: proposed.files.length },
    })
    const pr = await delivery.openPullRequest({ branch, title, body: proposed.summary })
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
      payload: { phase: "push", branch, error: String(err) },
    })
    return null
  }
}

/**
 * QA quality gate: a QA/Test agent verifies the acceptance criteria. Returns false only on a real
 * fail verdict; a QA runtime error (e.g. no credentials) records `qa_skipped` and does not block.
 */
export async function verifyTicket(ticketId: string): Promise<boolean> {
  const role = ROLES.qa_test
  const remaining = (await getBudgetRemaining(role.id)) ?? role.monthlyBudgetCents
  const [ticket, goalContext] = await Promise.all([getTicket(ticketId), getTraceContext(ticketId)])
  try {
    const verdict = await assess({
      role: role.id,
      systemPrompt: role.systemPrompt,
      goalContext,
      task: ticket
        ? `Verify ticket "${ticket.title}" meets its acceptance criteria: ${ticket.acceptanceCriteria.join("; ") || "(none specified)"}.`
        : `Verify ticket ${ticketId}.`,
      budgetCentsRemaining: remaining,
    })
    await addSpend(role.id, verdict.costCents)
    await appendAudit({
      actor: "qa_test",
      kind: verdict.passed ? "qa_passed" : "qa_failed",
      ticketId,
      payload: { summary: verdict.summary, costCents: verdict.costCents },
    })
    return verdict.passed
  } catch (err) {
    await appendAudit({
      actor: "system",
      kind: "qa_skipped",
      ticketId,
      payload: { error: String(err) },
    })
    return true
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

/** Merge the PR. Returns true on success (or nothing to merge), false on failure (audited). */
export async function mergeDelivery(ticketId: string, pr: PullRequestRef): Promise<boolean> {
  const delivery = deliveryFromEnv()
  if (!delivery) return true
  try {
    await delivery.merge(pr)
    await appendAudit({
      actor: "lead_engineer",
      kind: "pr_merged",
      ticketId,
      payload: { number: pr.number, url: pr.url },
    })
    return true
  } catch (err) {
    await appendAudit({
      actor: "system",
      kind: "merge_failed",
      ticketId,
      payload: { number: pr.number, error: String(err) },
    })
    return false
  }
}

// --- Deploy (GitHub Actions workflow_dispatch) -------------------------------

/**
 * Trigger a deploy via workflow_dispatch. Captures the latest run id *before* dispatch and returns
 * it as the baseline — the new run is the first one with a higher id (robust to clock skew). Returns
 * null when deploy isn't configured (skipped).
 */
export async function startDeploy(ticketId: string): Promise<number | null> {
  const delivery = deliveryFromEnv()
  if (!delivery || !DEPLOY_WORKFLOW) {
    await appendAudit({
      actor: "system",
      kind: "deploy_skipped",
      ticketId,
      payload: { reason: !delivery ? "GitHub not configured" : "no deploy workflow configured" },
    })
    return null
  }
  try {
    const afterRunId =
      (await delivery.latestRunId({ workflow: DEPLOY_WORKFLOW, ref: DEPLOY_REF })) ?? 0
    await delivery.dispatchWorkflow({
      workflow: DEPLOY_WORKFLOW,
      ref: DEPLOY_REF,
      inputs: { ticket: ticketId },
    })
    await appendAudit({
      actor: "lead_engineer",
      kind: "deploy_dispatched",
      ticketId,
      payload: { workflow: DEPLOY_WORKFLOW, ref: DEPLOY_REF, afterRunId },
    })
    return afterRunId
  } catch (err) {
    await appendAudit({
      actor: "system",
      kind: "deploy_error",
      ticketId,
      payload: { error: String(err) },
    })
    return null
  }
}

/** Status of the run dispatched after `afterRunId`. `pending` until it appears and completes. */
export async function checkDeployStatus(afterRunId: number): Promise<DeployState> {
  const delivery = deliveryFromEnv()
  if (!delivery || !DEPLOY_WORKFLOW) return "success"
  const run = await delivery.deploymentRunAfter({
    workflow: DEPLOY_WORKFLOW,
    ref: DEPLOY_REF,
    afterRunId,
  })
  return run?.state ?? "pending"
}

export async function recordDeploy(ticketId: string, state: DeployState): Promise<void> {
  await appendAudit({
    actor: "lead_engineer",
    kind: state === "success" ? "deployed" : "deploy_failed",
    ticketId,
    payload: { state },
  })
}
