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
| 9 | `6ece04c` | project backlog + roadmap | 16 tickets (ENG-001..016), PRD-001 (Kappa consensus), dependency-sequenced ROADMAP |
| 10 | `7f8e6b6` | Wave 0 — foundations | CI workflow; Temporal workflow tests via `@temporalio/testing` |
| 11 | `b7db668` | Wave 1 — safety + enablers | API auth + approval identity; structured outputs; CLI sandbox env scrub |
| 12 | `543d1b8` | Wave 2 — repo context | repo provisioning (PM `git`/`gh`) + two-root workspace; repo-aware coding agents |
| 13 | `624d363` | Wave 3 — governance | budget reset + atomic reservation; cyclic rework; first-class approvals; budget dashboard |

## Workspace packages & apps

| Path | Role | Key contents |
|------|------|--------------|
| `packages/core` | Domain heart (framework-agnostic) | zod schemas (`Mission→Goal→Epic→Ticket`, budgets, approvals, audit), 7 role personas, `Worker` / `DeliveryAdapter` / `IssueTracker` / `AuditLog` interfaces, budget helpers |
| `packages/db` | Persistence | Drizzle schema (8 FK-linked tables), `repo.ts` (tickets/audit/trace-context), client, migrations `0000`+`0001` |
| `packages/agents` | Agent runtime | `ClaudeWorker` (api/cli backends), `proposeFileChanges`, `proposeTickets` (decomposition), `draft` (shaping artifacts), `assess` (QA), pricing, prompt builder |
| `packages/integrations` | GitHub adapters | `GitHubDeliveryAdapter` (branch/commit/PR/checks/merge/deploy), `GitHubIssueTracker` (issues), `GitHubKnowledgeBase` (repo docs via Contents API) + factories |
| `apps/server` | Orchestration | Hono API (`app.ts`), Temporal `client`/`worker`/`workflows`/`activities` (incl. `epicShaping` + `epicDecomposition`), shaping-stage config, heartbeat schedule |
| `apps/web` | Dashboard | React + Vite, TanStack Router/Query, Board/Roadmap/Approvals/Audit pages, typed API client |

## Persistence (pluggable backends)

The agents' state persists through **ports in `core`** — `IssueTracker`, `KnowledgeBase`, `AuditLog`
— assembled by a **factory** (`createPersistence` / `persistenceFromEnv`) selected by
`PERSISTENCE_BACKEND`. Swapping backends never touches `core` or the workflow.

| Port | `postgres` backend | `github` backend |
|------|--------------------|------------------|
| Work items (`IssueTracker`) | `DbIssueTracker` | `GitHubIssueTracker` (issues; fields round-tripped in a metadata block) |
| Knowledge / docs (`KnowledgeBase`) | `DbKnowledgeBase` (`kb_docs`) | `GitHubKnowledgeBase` (Markdown under `docs/` via the Contents API) |
| Goal hierarchy (`Hierarchy`) | `DbHierarchy` (rows + trace join; goal/epic authoring) | `GitHubHierarchy` (mission/goal/epic as native **sub-issues**; authoring creates + links them) |
| Audit (`AuditLog`) | `DbAuditLog` | `DbAuditLog` (stays in Postgres — the dashboard read-model) |

> GitHub Wikis have **no REST/GraphQL API** (only a `.wiki.git` repo), so the KB uses repo files —
> the supported, reviewable equivalent.

The API and workflow are **fully routed through these ports** — tickets via `persistence.tracker`,
audit via `persistence.audit`, knowledge via `persistence.knowledge`, and the goal-hierarchy trace
via `persistence.hierarchy` — so `PERSISTENCE_BACKEND` governs where agent state lives. (Budgets stay
Postgres-direct — a control-plane concern.) On the GitHub backend the mission→goal→epic tree is
modelled with **native GitHub sub-issues** (parent→child Issues labelled `type:*`); each ticket is
linked as a sub-issue of its epic and `traceContext` walks the native parent chain (`GET
.../issues/{n}/parent`). Goals and epics are **authored through the same port**
(`createGoal`/`createEpic`/`listGoals`/`listEpics`, exposed at `/api/goals` + `/api/epics`), and a
ticket can target a chosen epic (`POST /api/tickets {epicId}`) — so work decomposes under multiple
epics. Verified live on Postgres (authoring + targeting); the GitHub adapters are unit-tested.

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
| shape (discovery → design → architecture → system design) | PM / UX / Architect / System Design agents draft artifacts (`epicShaping` → `draft`) | — |
| decompose | Lead Engineer agent → backlog tickets (`epicDecomposition` → `proposeTickets`) | **human (roadmap)** |
| plan → in_progress | Temporal workflow + status transitions | — |
| implement | coding agent writes files (`proposeFileChanges`) | — |
| branch + commit | Git Data API (`commitFiles`) | — |
| PR + CI | `openPullRequest` → poll `getChecks` | — |
| QA | QA agent verifies acceptance criteria (`verifyTicket`) | — (blocks on fail) |
| merge | `mergeDelivery` | **human (merge)** |
| deploy (ship) | `workflow_dispatch` → poll run | **human (deploy)** |

Full path:

```
Epic-level (agent planning, durable Temporal workflows):
  epic → SHAPE (PM discovery → UX design → architecture ADR → system design — artifacts to the KB)
       → [roadmap sign-off] → DECOMPOSE (Lead Engineer → backlog tickets, informed by the artifacts)

Each ticket then runs the delivery lifecycle:
  ticket → plan → CODE (agent writes files) → branch + commit → PR
         → CI poll → [merge approval] → merge
         → deploying → [deploy approval] → dispatch GitHub Actions deploy → poll run → done
```

Durable across restarts (Temporal), append-only audited, goal-traceable, budget-governed, with three
human approval gates (roadmap · merge · deploy). Every stage is a role agent (PM · UX · Architect · System Design · Lead Engineer
· Staff Eng · QA — all seven) running behind the central budget + audit.

## Verification & meta

| Item | State |
|------|-------|
| Quality gates | typecheck · tests **94/94** · web build · Biome lint clean — all **enforced by CI** (`.github/workflows/ci.yml`) on every PR to `main` |
| Live-proven | vertical slice, delivery loop, all three human gates (roadmap blocks→releases decomposition; merge; deploy), goal/epic authoring; agent planning — shaping (PM→UX→Architect→System Design, 4 stages) + gated decomposition — wired API→Temporal→agent→audit (Postgres + Temporal) |
| Unit-tested (no live creds) | **Temporal workflows** via `@temporalio/testing` time-skipping (both gates, QA/merge/deploy block paths, **rework loop**, roadmap gate, shaping, heartbeat); GitHub adapter (branch/PR/checks/merge/commit/deploy); `parseProposal`/`parseTickets`; structured-output schemas; `draft`/worker budget guards; pricing + `estimateRunCostCents`; budget reset/reservation helpers (`periodExpired`/`canReserve`); `sandboxEnv` (secret-scrub + PM token); workspace/provision helpers; API `checkAuth` + middleware |
| Infra | `docker compose up` turnkey: Postgres → auto-migrate → Temporal → UI → server → worker → web |
| Docs | `CLAUDE.md` (north-star + decisions), `README.md`, this overview, and `project/` (16-ticket backlog, PRD-001, ROADMAP) |

## Hardening & gaps closed (latest)

| Area | Status |
|------|--------|
| Deploy run correlation | run-id based (latestRunId/deploymentRunAfter) — robust to clock skew |
| Failure paths | Temporal retry policy; failed merge/deploy → ticket `blocked` (no longer reaches `done`) |
| Observability | Audit view renders cost / PR+run links / deploy state / file count |
| `IssueTracker` | concrete `DbIssueTracker` (Postgres-backed; conforms the store to the interface) |
| Heartbeat | Temporal Schedule auto-starts `backlog` tickets (verified: ~5s pickup) |
| Budgets | per-role, **monthly-windowed** (lazy reset); every agent step holds cost via an atomic **reserve→reconcile** so concurrent runs can't jointly overspend (ENG-007) |
| QA/Test | QA agent verifies acceptance criteria after implementation; a fail drives the cyclic rework loop, then blocks |
| Approval gates | **first-class persisted records** (roadmap · merge · deploy), created when a gate is reached and resolved with the deciding principal (`decidedBy`); `/api/approvals` lists all kinds (ENG-006) |
| Agent sandboxes | two roots — throwaway **env-scrubbed** agent-state sandbox (`workspaces/`; secrets withheld, only the PM gets a scoped git/gh token, ENG-005) + persistent **working-code workspace** (`workspace/`) where coding runs against a cloned target repo (ENG-001/013); the `api` backend is tool-less but uses **structured outputs** (ENG-009) |
| Decomposition | Lead Engineer agent breaks an epic into backlog tickets (`epicDecomposition` workflow); each ticket then runs its own lifecycle |
| CI | GitHub Actions runs typecheck/lint/test/build on every PR to `main` (ENG-003) |
| Workflow tests | `@temporalio/testing` time-skipping suite over `ticketLifecycle` / `epicDecomposition` (ENG-002) |
| API auth | bearer-token middleware on mutating routes (opt-in via `API_AUTH_TOKEN`); approval identity recorded (ENG-004) |
| Repo provisioning | idempotent `ensureRepoCloned` (shallow clone / ff-pull) into the working-code workspace; PM owns it via granted `git`/`gh` (ENG-013) |
| Cyclic rework | QA fail → bounded re-implement-with-feedback loop, then `blocked` (ENG-008) |
| Budget dashboard | `/api/budgets` + a web Budgets page (per-role limit/spent/remaining + unit total) (ENG-010) |

## Roadmap delivered (Waves 0–3 · `project/`)

Waves 0–3 (**14 of the 16** backlog tickets) are merged to `main`; **Wave 4** (provenance + consensus)
remains (see `project/ROADMAP.md` for the dependency-sequenced plan):

- **Wave 0 — foundations:** ENG-003 CI · ENG-002 Temporal workflow tests · ENG-011/012/015 decisions
  (GitHub Issues default · A2A monitor-only · SurrealDB no-go).
- **Wave 1 — safety + enablers:** ENG-004 API auth + approval identity · ENG-009 structured outputs ·
  ENG-005 CLI sandbox env scrub.
- **Wave 2 — repo-context critical path:** ENG-013 repo provisioning + two-root workspace · ENG-001
  repo-aware coding agents.
- **Wave 3 — governance / observability:** ENG-007 budget reset + reservation · ENG-006 first-class
  approvals · ENG-010 budget dashboard · ENG-008 cyclic rework.
- **Wave 4 — provenance + consensus (remaining):** ENG-014 decision log / provenance tree · ENG-016
  Kappa-style consensus (PRD-001).

## Not yet built (honest gaps)

- Linear / Jira `IssueTracker` backends (GitHub + Postgres exist); a literal GitHub Wiki
  (`.wiki.git`) KB adapter.
- **Wave deferrals** (noted in the tickets): literal `claude --allowedTools` tool-name gating — the
  PM `git`/`gh` boundary is enforced by the scoped token instead (ENG-013); per-epic repo
  *association* (the target repo is `GITHUB_OWNER`/`GITHUB_REPO` for now); API-backend file-context
  injection (the CLI backend is the repo-aware path, ENG-001); real GitHub re-push on a rework retry
  (ENG-008); shaping artifacts still run ungated.
- API auth is opt-in (activates with `API_AUTH_TOKEN`) and GET read views are open — require-by-default
  and protecting reads is an operator hardening decision.
- DB-layer logic in `repo.ts` isn't unit-tested (no live DB in CI); its pure helpers are.
- A true end-to-end run needs real credentials: `ANTHROPIC_API_KEY` + a GitHub repo / token / deploy
  workflow (it bills and creates real objects).
