import { NativeConnection, Worker } from "@temporalio/worker"
import * as activities from "./activities"

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "engineering"

/**
 * The Temporal server address. The worker MUST honor `TEMPORAL_ADDRESS` so it can reach Temporal
 * across containers (e.g. `temporal:7233` under Docker Compose). Creating the `Worker` without an
 * explicit connection silently defaults to `localhost:7233` — which works locally but makes the
 * worker unable to reach Temporal in Docker, so it crashes on startup with a connection refused.
 */
export function resolveTemporalAddress(env: NodeJS.ProcessEnv = process.env): string {
  return env.TEMPORAL_ADDRESS ?? "localhost:7233"
}

export async function runTemporalWorker(): Promise<void> {
  const address = resolveTemporalAddress()
  const connection = await NativeConnection.connect({ address })
  const worker = await Worker.create({
    connection,
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
    taskQueue: TASK_QUEUE,
  })
  console.log(`[worker] polling task queue "${TASK_QUEUE}" @ ${address}`)
  await worker.run()
}
