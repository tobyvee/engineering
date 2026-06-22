# engineering

Autonomous engineering management & delivery for a single cross-functional engineering org unit.
See [CLAUDE.md](./CLAUDE.md) for the full architecture and the decisions log.

## Quickstart

```bash
pnpm install
cp .env.example .env

# Full local stack (Postgres + Temporal + Temporal UI + server + worker):
docker compose up -d

# …or run the app directly against local infra:
pnpm dev
```

- API health: http://localhost:3000/health
- Temporal UI: http://localhost:8080

## Layout

| Path | Role |
| --- | --- |
| `packages/core` | Domain model, zod schemas, and the `Worker` / `DeliveryAdapter` / `IssueTracker` / `AuditLog` interfaces. The framework-agnostic heart. |
| `packages/db` | Postgres schema + Drizzle client. |
| `packages/agents` | Claude Agent SDK worker runtime (`ClaudeWorker`). |
| `packages/integrations` | `DeliveryAdapter` implementations — GitHub first. |
| `apps/server` | Hono HTTP API + Temporal worker/workflows (durable ticket lifecycle). |
| `apps/web` | React + Vite dashboard (TanStack Router + Query) for the accountable lead. |

## Common commands

```bash
pnpm dev          # turbo run dev
pnpm typecheck
pnpm lint         # biome
pnpm test         # vitest
pnpm db:generate  # drizzle-kit generate
pnpm db:migrate   # drizzle-kit migrate
```
