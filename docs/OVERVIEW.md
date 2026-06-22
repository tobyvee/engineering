# Project Overview

An autonomous engineering management & delivery tool for a single cross-functional engineering org
unit — like [Paperclip](https://paperclipai.net/), scoped to one unit and taken deep into the
product-development lifecycle. See [`CLAUDE.md`](../CLAUDE.md) for the north-star architecture and the
full decisions log; this file is a snapshot inventory of what's been built.

## Commits (chronological, on `main`)

| # | SHA | Title | Delivered |
|---|-----|-------|-----------|
| 1 | `03e5afc` | scaffold monorepo skeleton | pnpm + Turborepo workspace, 6 packages, tooling, Docker Compose; typechecks/lints/tests/boots |
| 2 | `8828c4b` | wire first vertical slice | DB persistence + repo, Temporal durable ticket lifecycle, approval gate, audit; proven live |
| 3 | `c63f550` | implement ClaudeWorker | Agent runtime — Anthropic API + `claude -p` CLI backends, budget guard, pricing |
| 4 | `0b9d15a` | auto-migrate in Compose | one-shot `migrate` service; server/worker gate on it |
| 5 | `8cd6525` | GitHub DeliveryAdapter | octokit branch/PR/checks/merge |
| 6 | `d345d24` | wire delivery loop | workflow drives open-PR → CI poll → merge via activities |
| 7 | `146f5a6` | coding-agent push | agent proposes file changes → committed to branch (Git Data API) before PR |
| 8 | `0b1375d` | human-gated deploy | `deploying` status + 2nd gate + Actions `workflow_dispatch` + run poll |

## Workspace packages & apps

| Path | Role | Key contents |
|------|------|--------------|
| `packages/core` | Domain heart (framework-agnostic) | zod schemas (`Mission→Goal→Epic→Ticket`, budgets, approvals, audit), 7 role personas, `Worker` / `DeliveryAdapter` / `IssueTracker` / `AuditLog` interfaces, budget helpers |
| `packages/db` | Persistence | Drizzle schema (8 FK-linked tables), `repo.ts` (tickets/audit/trace-context), client, migrations `0000`+`0001` |
| `packages/agents` | Agent runtime | `ClaudeWorker` (api/cli backends), `proposeFileChanges` + `parseProposal`, pricing, prompt builder |
| `packages/integrations` | GitHub adapters | `GitHubDeliveryAdapter` (branch/commit/PR/checks/merge/deploy), `GitHubIssueTracker` (issues), `GitHubKnowledgeBase` (repo docs via Contents API) + factories |
| `apps/server` | Orchestration | Hono API (`app.ts`), Temporal `client`/`worker`/`workflows`/`activities`, heartbeat stub |
| `apps/web` | Dashboard | React + Vite, TanStack Router/Query, Board/Approvals/Audit pages, typed API client |

## Persistence (pluggable backends)

The agents' state persists through **ports in `core`** — `IssueTracker`, `KnowledgeBase`, `AuditLog`
— assembled by a **factory** (`createPersistence` / `persistenceFromEnv`) selected by
`PERSISTENCE_BACKEND`. Swapping backends never touches `core` or the workflow.

| Port | `postgres` backend | `github` backend |
|------|--------------------|------------------|
| Work items (`IssueTracker`) | `DbIssueTracker` | `GitHubIssueTracker` (issues; fields round-tripped in a metadata block) |
| Knowledge / docs (`KnowledgeBase`) | `DbKnowledgeBase` (`kb_docs`) | `GitHubKnowledgeBase` (Markdown under `docs/` via the Contents API) |
| Goal trace (`Hierarchy`) | `DbHierarchy` (mission→goal→epic join) | `GitHubHierarchy` (mission/goal/epic as native **sub-issues**; tickets are sub-issues of an epic) |
| Audit (`AuditLog`) | `DbAuditLog` | `DbAuditLog` (stays in Postgres — the dashboard read-model) |

> GitHub Wikis have **no REST/GraphQL API** (only a `.wiki.git` repo), so the KB uses repo files —
> the supported, reviewable equivalent.

The API and workflow are **fully routed through these ports** — tickets via `persistence.tracker`,
audit via `persistence.audit`, knowledge via `persistence.knowledge`, and the goal-hierarchy trace
via `persistence.hierarchy` — so `PERSISTENCE_BACKEND` governs where agent state lives. (Budgets stay
Postgres-direct — a control-plane concern.) On the GitHub backend the mission→goal→epic tree is
modelled with **native GitHub sub-issues** (parent→child Issues labelled `type:*`); each ticket is
linked as a sub-issue of its epic and `traceContext` walks the native parent chain (`GET
.../issues/{n}/parent`). Verified live on Postgres; the GitHub adapters are unit-tested.

## Settled decisions (with rejected alternatives)

| Area | Choice | Not chosen |
|------|--------|-----------|
| Language / stack | TypeScript/Node monorepo | Go, **Python** |
| Roles (7) | PM · UX/Design · Lead Architect · Lead System Design · Lead Engineer · Staff Eng (IC) · QA/Test | — |
| Durable engine | **Temporal** (MIT, OSS) | Inngest (SSPL), pg-boss; Dagster/Prefect/LangChain (wrong paradigm) |
| Agent step | Claude Agent (LLM-driven routing) | static DAG |
| API / lint / tests | Hono · Biome · Vitest | — |
| DB / validation | Postgres + Drizzle · zod | — |
| Delivery / deploy | GitHub (octokit) · Actions `workflow_dispatch` | — |
| Web | React + Vite (TanStack) | Next.js |
| Agent runtime | `ClaudeWorker`: Anthropic API **+** `claude -p` CLI | — |

## Lifecycle implemented

| Stage | Mechanism | Gate |
|-------|-----------|------|
| plan → in_progress | Temporal workflow + status transitions | — |
| implement | coding agent writes files (`proposeFileChanges`) | — |
| branch + commit | Git Data API (`commitFiles`) | — |
| PR + CI | `openPullRequest` → poll `getChecks` | — |
| QA | QA agent verifies acceptance criteria (`verifyTicket`) | — (blocks on fail) |
| merge | `mergeDelivery` | **human (merge)** |
| deploy (ship) | `workflow_dispatch` → poll run | **human (deploy)** |

Full path:

```
ticket → plan → CODE (agent writes files) → branch + commit → PR
       → CI poll → [merge approval] → merge
       → deploying → [deploy approval] → dispatch GitHub Actions deploy → poll run → done
```

Durable across restarts (Temporal), append-only audited, goal-traceable, budget-governed, with two
human approval gates.

## Verification & meta

| Item | State |
|------|-------|
| Quality gates | typecheck 6/6 · tests 38/38 · Biome lint clean |
| Live-proven | vertical slice, delivery loop, both human gates (on Postgres + Temporal) |
| Unit-tested (no live creds) | GitHub adapter (branch/PR/checks/merge/commit/deploy), `parseProposal`, pricing/budget |
| Infra | `docker compose up` turnkey: Postgres → auto-migrate → Temporal → UI → server → worker → web |
| Docs | `CLAUDE.md` (north-star + decisions), `README.md`, this overview |

## Hardening & gaps closed (latest)

| Area | Status |
|------|--------|
| Deploy run correlation | run-id based (latestRunId/deploymentRunAfter) — robust to clock skew |
| Failure paths | Temporal retry policy; failed merge/deploy → ticket `blocked` (no longer reaches `done`) |
| Observability | Audit view renders cost / PR+run links / deploy state / file count |
| `IssueTracker` | concrete `DbIssueTracker` (Postgres-backed; conforms the store to the interface) |
| Heartbeat | Temporal Schedule auto-starts `backlog` tickets (verified: ~5s pickup) |
| Budgets | seeded per role; `implementTicket`/`verifyTicket` read remaining (limit−spent) and record spend |
| QA/Test | QA agent verifies acceptance criteria after implementation; a fail blocks the ticket |

## Not yet built (honest gaps)

- Linear / Jira `IssueTracker` backends (GitHub + Postgres exist); a literal GitHub Wiki
  (`.wiki.git`) KB adapter; multi-epic/goal authoring on GitHub (the sub-issue seed creates a single
  default mission→goal→epic chain — PM/Lead Engineer decomposing work into many is the next step).
- Earlier lifecycle stages (discovery/design/architecture by PM/UX/Architect) and work decomposition
  (Lead Engineer breaking epics into tickets) — the slice jumps straight to implementation.
- No remote / CI for this repo itself.
- A true end-to-end run needs real credentials: `ANTHROPIC_API_KEY` + a GitHub repo / token / deploy
  workflow (it bills and creates real objects).
