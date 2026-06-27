import { condition, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow"
import { SHAPING_STAGES } from "../shaping"
import type * as activities from "./activities"

const {
  transitionTicket,
  implementTicket,
  verifyTicket,
  checkDeliveryStatus,
  mergeDelivery,
  startDeploy,
  checkDeployStatus,
  recordDeploy,
  pickUpBacklog,
  decomposeEpic,
  runShapingStage,
  requestRoadmapSignoff,
  recordRoadmapApproval,
  requestApproval,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3 },
})

/** Roadmap sign-off gate — the dashboard signals this to release an epic's decomposition. */
export const roadmapSignal = defineSignal("roadmapApprove")

/** Heartbeat: fired on a schedule; starts the lifecycle for any backlog tickets. */
export async function heartbeat(): Promise<void> {
  await pickUpBacklog()
}

/**
 * Upstream shaping as a durable pipeline: PM discovery → UX design → architecture. Each stage's
 * agent drafts an artifact (retried on failure) that the next stage — and the Lead Engineer's
 * decomposition — builds on. Sequential so the handoff accumulates.
 */
export async function epicShaping(epicId: string): Promise<void> {
  for (const stage of SHAPING_STAGES) {
    await runShapingStage(epicId, stage.key)
  }
}

/**
 * Agent-driven decomposition behind a human roadmap sign-off gate (invariant #4): the workflow
 * requests sign-off and *blocks* until the lead approves the plan, then the Lead Engineer breaks the
 * epic into backlog tickets (retried on failure). Each ticket then runs its own `ticketLifecycle`
 * (started by the human on the Board, or auto-picked by the heartbeat).
 */
export async function epicDecomposition(epicId: string): Promise<void> {
  let approved = false
  setHandler(roadmapSignal, () => {
    approved = true
  })

  await requestRoadmapSignoff(epicId)
  await condition(() => approved)
  await recordRoadmapApproval(epicId)
  await decomposeEpic(epicId)
}

/**
 * Human approval gates — the dashboard signals these to release the durable waits. One signal
 * carries which gate is being approved: `merge` (the review/merge gate) or `deploy` (the ship gate).
 */
export const approveSignal = defineSignal<["merge" | "deploy"]>("approve")

const CI_POLL_INTERVAL = "30 seconds"
const CI_MAX_POLLS = 20
const DEPLOY_POLL_INTERVAL = "30 seconds"
const DEPLOY_MAX_POLLS = 20
/** Bounded implement→review→QA rework attempts before a ticket is blocked for a human (ENG-008). */
const MAX_IMPLEMENT_ATTEMPTS = 2

/**
 * The ticket lifecycle as a durable state machine, with the full delivery + deploy loop:
 *
 *   planned → in_progress → [agent writes code → branch + commit + PR] → in_review
 *     → poll CI → [merge gate] → merge → deploying → [deploy gate]
 *     → dispatch deploy (Actions workflow_dispatch) → poll run → done
 *
 * Both gates are human approvals (invariant #4). All GitHub/DB/agent I/O is in activities; the
 * workflow only orchestrates with deterministic timers and the approval `condition`s. Delivery and
 * deploy are no-ops when GitHub / the deploy workflow aren't configured, so the lifecycle still
 * completes — but the ship gate still blocks for the human sign-off.
 */
export async function ticketLifecycle(ticketId: string): Promise<void> {
  const approved = { merge: false, deploy: false }
  setHandler(approveSignal, (gate) => {
    approved[gate] = true
  })

  await transitionTicket(ticketId, "planned")
  await sleep("2 seconds")

  // Cyclic rework (ENG-008): implement → review → QA, bouncing back to in_progress with the QA
  // feedback on a fail, up to MAX_IMPLEMENT_ATTEMPTS, then block for human attention.
  let pr: Awaited<ReturnType<typeof implementTicket>> = null
  let passed = false
  let feedback: string | undefined
  for (let attempt = 1; attempt <= MAX_IMPLEMENT_ATTEMPTS && !passed; attempt++) {
    await transitionTicket(ticketId, "in_progress")
    pr = await implementTicket(ticketId, feedback)
    await transitionTicket(ticketId, "in_review")
    const qa = await verifyTicket(ticketId)
    passed = qa.passed
    feedback = qa.feedback
  }
  if (!passed) {
    await transitionTicket(ticketId, "blocked")
    return
  }

  // Wait for CI to settle, bounded. Skipped when there's no PR.
  if (pr) {
    let status = await checkDeliveryStatus(pr)
    for (let i = 0; status === "pending" && i < CI_MAX_POLLS; i++) {
      await sleep(CI_POLL_INTERVAL)
      status = await checkDeliveryStatus(pr)
    }
  }

  // Merge gate: record a pending approval (ENG-006), then block until the human lead signs off.
  await requestApproval("pr_merge", ticketId)
  await condition(() => approved.merge)
  const merged = pr ? await mergeDelivery(ticketId, pr) : true
  if (!merged) {
    await transitionTicket(ticketId, "blocked")
    return
  }

  // Ship: human-gated deploy (record a pending approval first, ENG-006).
  await transitionTicket(ticketId, "deploying")
  await requestApproval("deploy", ticketId)
  await condition(() => approved.deploy)
  const afterRunId = await startDeploy(ticketId)
  if (afterRunId !== null) {
    let state = await checkDeployStatus(afterRunId)
    for (let i = 0; state === "pending" && i < DEPLOY_MAX_POLLS; i++) {
      await sleep(DEPLOY_POLL_INTERVAL)
      state = await checkDeployStatus(afterRunId)
    }
    await recordDeploy(ticketId, state)
    if (state === "failure") {
      await transitionTicket(ticketId, "blocked")
      return
    }
  }

  await transitionTicket(ticketId, "done")
}
