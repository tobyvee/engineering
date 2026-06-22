# @eng/web — dashboard

The web dashboard for the unit's accountable lead: org view, ticket board, approvals, budgets, and
the audit read-view.

**Stack:** React + Vite, [TanStack Router](https://tanstack.com/router) (code-based routes) and
[TanStack Query](https://tanstack.com/query) for data. It is a **SPA over the Hono API** — it holds
no server logic of its own, which keeps the `core` boundary clean (the UI is a read view over the
API, per invariant #5). In dev, Vite proxies `/api` and `/health` to the server (default
`http://localhost:3000`, overridable via `API_PROXY_TARGET`).

```bash
pnpm --filter @eng/web dev   # http://localhost:5173 (run the API too: pnpm --filter @eng/server dev)
```
