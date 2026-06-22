import { Worker } from "@temporalio/worker"
import * as activities from "./activities"

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "engineering"

export async function runTemporalWorker(): Promise<void> {
  const worker = await Worker.create({
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
    taskQueue: TASK_QUEUE,
  })
  console.log(`[worker] polling task queue "${TASK_QUEUE}"`)
  await worker.run()
}
