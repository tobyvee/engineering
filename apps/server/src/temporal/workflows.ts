import { condition, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow"
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
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3 },
})

/** Heartbeat: fired on a schedule; starts the lifecycle for any backlog tickets. */
export async function heartbeat(): Promise<void> {
  await pickUpBacklog()
}

/**
 * Agent-driven decomposition as a durable step: the Lead Engineer breaks the epic into backlog
 * tickets (retried on failure). Each ticket then runs its own `ticketLifecycle` (started by the
 * human on the Board, or auto-picked by the heartbeat).
 */
export async function epicDecomposition(epicId: string): Promise<void> {
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
  await transitionTicket(ticketId, "in_progress")

  // Agent writes the code and (when GitHub is configured) pushes a branch + opens a PR.
  const pr = await implementTicket(ticketId)
  await transitionTicket(ticketId, "in_review")

  // QA quality gate: the QA agent verifies the acceptance criteria before review/merge.
  const qaOk = await verifyTicket(ticketId)
  if (!qaOk) {
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

  // Merge gate: block until the human lead signs off on the merge.
  await condition(() => approved.merge)
  const merged = pr ? await mergeDelivery(ticketId, pr) : true
  if (!merged) {
    await transitionTicket(ticketId, "blocked")
    return
  }

  // Ship: human-gated deploy.
  await transitionTicket(ticketId, "deploying")
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
