import { getTemporalClient } from "./temporal/client"

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "engineering"

/**
 * Heartbeat: a Temporal Schedule that fires the `heartbeat` workflow on a cadence; the workflow
 * picks up any `backlog` tickets and starts their durable lifecycle (so created tickets advance
 * without a manual start). Idempotent — safe to call on every boot.
 */
export async function startHeartbeat(): Promise<void> {
  const client = await getTemporalClient()
  try {
    await client.schedule.create({
      scheduleId: "engineering-heartbeat",
      spec: { intervals: [{ every: "30s" }] },
      action: {
        type: "startWorkflow",
        workflowType: "heartbeat",
        taskQueue: TASK_QUEUE,
        workflowId: "heartbeat",
      },
    })
  } catch (err) {
    // A schedule from a previous boot already exists — that's fine.
    if ((err as { name?: string })?.name !== "ScheduleAlreadyRunning") {
      console.error("[heartbeat] schedule create failed", err)
    }
  }
}
