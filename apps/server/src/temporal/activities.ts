import { proposeFileChanges } from "@eng/agents"
import {
  type DeliveryAdapter,
  type DeployState,
  type PullRequestRef,
  ROLES,
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

  let proposed: Awaited<ReturnType<typeof proposeFileChanges>> | null = null
  try {
    proposed = await proposeFileChanges({
      role: role.id,
      systemPrompt: role.systemPrompt,
      goalContext,
      task: ticket
        ? `Implement ticket "${ticket.title}": ${ticket.description || "(no description provided)"}.`
        : `Implement ticket ${ticketId}.`,
      budgetCentsRemaining: role.monthlyBudgetCents,
    })
    await appendAudit({
      actor: "staff_engineer",
      kind: "agent_step",
      ticketId,
      payload: {
        stage: "implementation",
        summary: proposed.summary,
        costCents: proposed.costCents,
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

// --- Deploy (GitHub Actions workflow_dispatch) -------------------------------

/** Trigger a deploy via workflow_dispatch. Returns the dispatch time (for run lookup) or null. */
export async function startDeploy(ticketId: string): Promise<string | null> {
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
  const since = new Date().toISOString()
  try {
    await delivery.dispatchWorkflow({
      workflow: DEPLOY_WORKFLOW,
      ref: DEPLOY_REF,
      inputs: { ticket: ticketId },
    })
    await appendAudit({
      actor: "lead_engineer",
      kind: "deploy_dispatched",
      ticketId,
      payload: { workflow: DEPLOY_WORKFLOW, ref: DEPLOY_REF },
    })
    return since
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

/** Find the dispatched run's status. `pending` until it appears and completes. */
export async function checkDeployStatus(since: string): Promise<DeployState> {
  const delivery = deliveryFromEnv()
  if (!delivery || !DEPLOY_WORKFLOW) return "success"
  const run = await delivery.latestDeploymentRun({
    workflow: DEPLOY_WORKFLOW,
    ref: DEPLOY_REF,
    since,
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
