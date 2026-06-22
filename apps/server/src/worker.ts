import { runTemporalWorker } from "./temporal/worker"

runTemporalWorker().catch((err) => {
  console.error("[worker] fatal", err)
  process.exit(1)
})
