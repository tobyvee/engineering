import { condition, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow"
import type * as activities from "./activities"

const { transitionTicket, implementTicket, checkDeliveryStatus, mergeDelivery } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "10 minutes",
})

/** Human approval gate — the dashboard signals this to release the durable wait. */
export const approveSignal = defineSignal<[boolean]>("approve")

const CI_POLL_INTERVAL = "30 seconds"
const CI_MAX_POLLS = 20

/**
 * The ticket lifecycle as a durable state machine, with the delivery loop wired in:
 *
 *   planned → in_progress → [agent writes code → branch + commit + PR] → in_review
 *           → poll CI (bounded) → [human approval gate] → merge → done
 *
 * All GitHub/DB/agent I/O happens in activities; the workflow only orchestrates with deterministic
 * timers (`sleep`) and the approval `condition`. Delivery is a no-op when GitHub isn't configured,
 * so the lifecycle still completes. The approval gate blocks — potentially for days — across restarts.
 */
export async function ticketLifecycle(ticketId: string): Promise<void> {
  let approved = false
  setHandler(approveSignal, (ok) => {
    approved = ok
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

  // Approval gate (invariant #4): block until the human lead signs off on the merge.
  await condition(() => approved)

  if (pr) {
    await mergeDelivery(ticketId, pr)
  }
  await transitionTicket(ticketId, "done")
}
