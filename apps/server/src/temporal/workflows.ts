import { condition, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow"
import type * as activities from "./activities"

const { transitionTicket, runAgentStep } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
})

/** Human approval gate — the dashboard signals this to release the durable wait. */
export const approveSignal = defineSignal<[boolean]>("approve")

/**
 * The ticket lifecycle as a durable state machine. Stages are states with human gates: the workflow
 * blocks on `condition(() => approved)` — potentially for days — and survives process restarts.
 * The short sleeps make the intermediate transitions observable on the Board; real routing is
 * agent-driven and can loop (review bounces back, blockers re-queue).
 */
export async function ticketLifecycle(ticketId: string): Promise<void> {
  let approved = false
  setHandler(approveSignal, (ok) => {
    approved = ok
  })

  await transitionTicket(ticketId, "planned")
  await sleep("2 seconds")
  await transitionTicket(ticketId, "in_progress")
  await runAgentStep(ticketId, "implementation")
  await sleep("2 seconds")
  await transitionTicket(ticketId, "in_review")

  // Approval gate (invariant #4): block until the human lead signs off.
  await condition(() => approved)

  await transitionTicket(ticketId, "done")
}
