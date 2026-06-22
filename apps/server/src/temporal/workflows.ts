import { condition, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow"
import type * as activities from "./activities"

const {
  transitionTicket,
  implementTicket,
  checkDeliveryStatus,
  mergeDelivery,
  startDeploy,
  checkDeployStatus,
  recordDeploy,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
})

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
  if (pr) {
    await mergeDelivery(ticketId, pr)
  }

  // Ship: human-gated deploy.
  await transitionTicket(ticketId, "deploying")
  await condition(() => approved.deploy)
  const since = await startDeploy(ticketId)
  if (since) {
    let state = await checkDeployStatus(since)
    for (let i = 0; state === "pending" && i < DEPLOY_MAX_POLLS; i++) {
      await sleep(DEPLOY_POLL_INTERVAL)
      state = await checkDeployStatus(since)
    }
    await recordDeploy(ticketId, state)
  }

  await transitionTicket(ticketId, "done")
}
