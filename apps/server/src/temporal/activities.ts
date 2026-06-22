import { assess, draft, proposeFileChanges, proposeTickets } from "@eng/agents"
import {
  type DeliveryAdapter,
  type DeployState,
  type PullRequestRef,
  ROLES,
  type TicketStatus,
} from "@eng/core"
import { addSpend, getBudgetRemaining } from "@eng/db"
import { createGitHubDelivery } from "@eng/integrations"
import { persistenceFromEnv } from "../persistence"
import { artifactPath, SHAPING_STAGES } from "../shaping"
import { startTicketLifecycle } from "./client"

/**
 * Activities are the side-effecting steps the durable workflow calls. They run in the normal Node
 * runtime and — unlike workflow code — need not be deterministic. Ticket state + audit go through
 * the persistence layer (backend selected by PERSISTENCE_BACKEND); the goal-hierarchy trace and
 * budgets stay in Postgres (control-plane concerns the tracker port doesn't model).
 */
const persistence = persistenceFromEnv()

export async function transitionTicket(ticketId: string, status: TicketStatus): Promise<void> {
  await persistence.tracker.transition(ticketId, status)
  await persistence.audit.append({
    actor: "system",
    kind: "state_change",
    ticketId,
    payload: { status },
  })
}

/** The artifacts (requirements/design/ADR) drafted for an epic by the upstream shaping stages. */
async function epicArtifacts(epicId: string): Promise<string[]> {
  const docs: string[] = []
  for (const s of SHAPING_STAGES) {
    const doc = await persistence.knowledge.read(artifactPath(epicId, s.key))
    if (doc) docs.push(doc)
  }
  return docs
}

/**
 * One upstream shaping stage: a role agent (PM / UX / Architect) drafts an artifact for the epic,
 * informed by the epic's why plus the artifacts from earlier stages (accumulating handoff). The
 * artifact is persisted to the KB and audited. Budget-enforced (invariant #3); a runtime error
 * records `artifact_skipped` and the pipeline continues.
 */
export async function runShapingStage(epicId: string, stageKey: string): Promise<void> {
  const stage = SHAPING_STAGES.find((s) => s.key === stageKey)
  if (!stage) return
  const role = ROLES[stage.role]
  const remaining = (await getBudgetRemaining(role.id)) ?? role.monthlyBudgetCents

  const epicCtx = await persistence.hierarchy.epicContext(epicId)
  const prior: string[] = []
  for (const s of SHAPING_STAGES) {
    if (s.key === stageKey) break
    const doc = await persistence.knowledge.read(artifactPath(epicId, s.key))
    if (doc) prior.push(doc)
  }
  const goalContext = [epicCtx, ...prior].join("\n\n")

  try {
    const result = await draft({
      role: role.id,
      systemPrompt: role.systemPrompt,
      goalContext,
      task: stage.task,
      budgetCentsRemaining: remaining,
    })
    await addSpend(role.id, result.costCents)
    await persistence.knowledge.write(
      artifactPath(epicId, stageKey),
      `# ${stage.title}\n\n${result.content}\n`,
    )
    await persistence.audit.append({
      actor: role.id,
      kind: "artifact_drafted",
      ticketId: null,
      payload: { epicId, stage: stageKey, costCents: result.costCents },
    })
  } catch (err) {
    await persistence.audit.append({
      actor: "system",
      kind: "artifact_skipped",
      ticketId: null,
      payload: { epicId, stage: stageKey, error: String(err) },
    })
  }
}

/** Record that an epic's plan is awaiting the human roadmap sign-off (the gate is pending). */
export async function requestRoadmapSignoff(epicId: string): Promise<void> {
  await persistence.audit.append({
    actor: "lead_engineer",
    kind: "roadmap_requested",
    ticketId: null,
    payload: { epicId },
  })
}

/** Record the human roadmap sign-off (the gate released decomposition). */
export async function recordRoadmapApproval(epicId: string): Promise<void> {
  await persistence.audit.append({
    actor: "human",
    kind: "roadmap_approved",
    ticketId: null,
    payload: { epicId },
  })
}

/**
 * Agent-driven decomposition: the Lead Engineer agent breaks an epic into implementable tickets,
 * each created in `backlog` under the epic (traceable, invariant #1) and audited. The epic's why
 * plus any upstream artifacts (discovery/design/architecture) inform the breakdown. Budget is
 * enforced centrally (invariant #3). When the agent runtime is unavailable (e.g. no credentials), it
 * records `decomposition_skipped` and creates nothing — the no-op mirrors the implementation step.
 */
export async function decomposeEpic(epicId: string): Promise<string[]> {
  const role = ROLES.lead_engineer
  const [epicCtx, artifacts] = await Promise.all([
    persistence.hierarchy.epicContext(epicId),
    epicArtifacts(epicId),
  ])
  const goalContext = [epicCtx, ...artifacts].join("\n\n")
  const remaining = (await getBudgetRemaining(role.id)) ?? role.monthlyBudgetCents

  let proposed: Awaited<ReturnType<typeof proposeTickets>>
  try {
    proposed = await proposeTickets({
      role: role.id,
      systemPrompt: role.systemPrompt,
      goalContext,
      task: "Decompose this epic into implementable tickets.",
      budgetCentsRemaining: remaining,
    })
    await addSpend(role.id, proposed.costCents)
  } catch (err) {
    await persistence.audit.append({
      actor: "system",
      kind: "decomposition_skipped",
      ticketId: null,
      payload: { epicId, error: String(err) },
    })
    return []
  }

  const created: string[] = []
  for (const t of proposed.tickets) {
    const ticket = await persistence.tracker.createTicket({
      epicId,
      title: t.title,
      description: t.description,
      status: "backlog",
      stage: "implementation",
      assigneeRole: t.assigneeRole,
      acceptanceCriteria: t.acceptanceCriteria,
    })
    created.push(ticket.id)
    await persistence.audit.append({
      actor: "lead_engineer",
      kind: "ticket_created",
      ticketId: ticket.id,
      payload: { epicId, assigneeRole: t.assigneeRole, criteria: t.acceptanceCriteria.length },
    })
  }
  await persistence.audit.append({
    actor: "lead_engineer",
    kind: "epic_decomposed",
    ticketId: null,
    payload: { epicId, tickets: created.length, costCents: proposed.costCents },
  })
  return created
}

/** Start the lifecycle for any `backlog` tickets (idempotent). Driven by the heartbeat schedule. */
export async function pickUpBacklog(): Promise<number> {
  const backlog = await persistence.tracker.list({ status: "backlog" })
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
 * The implementation step: a Staff Engineer agent writes the code and persists notes to the KB; then
 * — if GitHub is configured — the changes are committed to a ticket branch and a PR is opened.
 * Returns the PR (for the later merge) or null.
 */
export async function implementTicket(ticketId: string): Promise<PullRequestRef | null> {
  const role = ROLES.staff_engineer
  const [ticket, goalContext] = await Promise.all([
    persistence.tracker.get(ticketId),
    persistence.hierarchy.traceContext(ticketId),
  ])
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
    await persistence.audit.append({
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
    await persistence.audit.append({
      actor: "system",
      kind: "agent_step_skipped",
      ticketId,
      payload: { stage: "implementation", error: String(err) },
    })
  }

  // Persist the implementation notes to the knowledge base (backend selected by PERSISTENCE_BACKEND).
  try {
    const doc = `# ${title}\n\n${goalContext}\n\n## Implementation notes\n\n${proposed?.summary ?? "(agent runtime unavailable)"}\n`
    await persistence.knowledge.write(`tickets/${ticketId}.md`, doc)
    await persistence.audit.append({
      actor: "staff_engineer",
      kind: "knowledge_written",
      ticketId,
      payload: { path: `tickets/${ticketId}.md` },
    })
  } catch (err) {
    await persistence.audit.append({
      actor: "system",
      kind: "knowledge_skipped",
      ticketId,
      payload: { error: String(err) },
    })
  }

  const delivery = deliveryFromEnv()
  if (!delivery) {
    await persistence.audit.append({
      actor: "system",
      kind: "delivery_skipped",
      ticketId,
      payload: { reason: "GitHub not configured" },
    })
    return null
  }
  if (!proposed || proposed.files.length === 0) {
    await persistence.audit.append({
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
    await persistence.audit.append({
      actor: "staff_engineer",
      kind: "code_pushed",
      ticketId,
      payload: { branch, sha: commit.sha, files: proposed.files.length },
    })
    const pr = await delivery.openPullRequest({ branch, title, body: proposed.summary })
    await persistence.audit.append({
      actor: "lead_engineer",
      kind: "pr_opened",
      ticketId,
      payload: { number: pr.number, url: pr.url, branch },
    })
    return pr
  } catch (err) {
    await persistence.audit.append({
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
  const [ticket, goalContext] = await Promise.all([
    persistence.tracker.get(ticketId),
    persistence.hierarchy.traceContext(ticketId),
  ])
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
    await persistence.audit.append({
      actor: "qa_test",
      kind: verdict.passed ? "qa_passed" : "qa_failed",
      ticketId,
      payload: { summary: verdict.summary, costCents: verdict.costCents },
    })
    return verdict.passed
  } catch (err) {
    await persistence.audit.append({
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
    await persistence.audit.append({
      actor: "lead_engineer",
      kind: "pr_merged",
      ticketId,
      payload: { number: pr.number, url: pr.url },
    })
    return true
  } catch (err) {
    await persistence.audit.append({
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
    await persistence.audit.append({
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
    await persistence.audit.append({
      actor: "lead_engineer",
      kind: "deploy_dispatched",
      ticketId,
      payload: { workflow: DEPLOY_WORKFLOW, ref: DEPLOY_REF, afterRunId },
    })
    return afterRunId
  } catch (err) {
    await persistence.audit.append({
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
  await persistence.audit.append({
    actor: "lead_engineer",
    kind: state === "success" ? "deployed" : "deploy_failed",
    ticketId,
    payload: { state },
  })
}
