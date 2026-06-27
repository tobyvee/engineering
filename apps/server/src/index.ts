import { serve } from "@hono/node-server"
import { app } from "./app"
import { warnIfAuthDisabled } from "./auth"
import { startHeartbeat } from "./scheduler"

const port = Number(process.env.PORT ?? 3000)

warnIfAuthDisabled()
serve({ fetch: app.fetch, port })
console.log(`[server] listening on http://localhost:${port}`)

startHeartbeat()
  .then(() => console.log("[heartbeat] schedule ensured"))
  .catch((err) => console.error("[heartbeat] setup failed", err))
