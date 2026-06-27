# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Status: the full product-development lifecycle is implemented and all 16 backlog tickets across
> Waves 0–4 in `project/` are complete. It has been validated end-to-end on a live model — a ticket
> ran shape → decompose → implement → QA → merge → deploy to `done` with real committed, QA-verified,
> merged code, fully offline (`DELIVERY_BACKEND=local`, no GitHub).** The pnpm + Turborepo monorepo passes `typecheck`/`lint`/`test` (144) + `build`,
> enforced by **CI** (`.github/workflows/ci.yml`) on every PR. The whole lifecycle runs as durable
> Temporal workflows against Postgres, with **all seven roles driving a stage** behind **three human
> approval gates** (roadmap · merge · deploy):
>
> - **Shape** (`epicShaping`): PM discovery → UX design → Lead Architect ADR → Lead System Design
>   each draft an artifact for an epic (`draft`), handed stage-to-stage and persisted to the KB.
> - **[roadmap gate]** → **Decompose** (`epicDecomposition`): the Lead Engineer agent
>   (`proposeTickets`) breaks the epic — informed by the shaping artifacts — into backlog tickets,
>   blocking until the human approves the plan (invariant #4).
> - **Per ticket** (`ticketLifecycle`): a Staff Engineer agent writes code (`proposeFileChanges`)
>   *against a cloned target repo* → branch + commit (Git Data API) → PR → CI poll → a QA agent gates
>   acceptance criteria, with a **bounded rework loop** (QA fail → re-implement with the feedback, up
>   to a cap, then `blocked`) → **[merge gate]** → merge → **[deploy gate]** → Actions
>   `workflow_dispatch` deploy → poll run → `done`.
>
> Every transition is appended to the append-only audit log; the Mission→Goal→Epic chain gives
> traceability, and **every agent step also emits a structured `Decision` into a provenance DAG**
> (ENG-014) traceable to the originating request (Postgres index + a PR-reviewable KB body, behind a
> `DecisionLog` port). An optional **Kappa-style consensus** step (ENG-016, `directionConsensus`) has
> the senior technical roles independently rate candidate implementation directions, gated by a
> chance-corrected inter-rater agreement coefficient with a human `architecture_decision` tie-break.
> **Per-role budgets are monthly-windowed and enforced by an atomic reserve→reconcile
> hold** (limit−spent, concurrency-safe); a Temporal Schedule auto-starts backlog tickets. **Approval
> gates are first-class persisted records** (roadmap · merge · deploy · architecture), resolved with
> the deciding principal's identity. Persistence is pluggable behind `core` ports (`IssueTracker` · `KnowledgeBase`
> · `Hierarchy` · `AuditLog` · `DecisionLog`) selected by `PERSISTENCE_BACKEND` = `postgres` | `github` (GitHub =
> Issues + repo-docs KB + the hierarchy as native sub-issues). A React dashboard surfaces the Board,
> Roadmap, Approvals, **Budgets**, and Audit. **The HTTP API is auth-gated** (bearer token; activates
> when `API_AUTH_TOKEN` is set). Agent runs are sandboxed: the `cli` backend runs in a throwaway,
> **env-scrubbed** sandbox (only the PM gets a scoped git/gh token) and codes against a separate
> **working-code workspace** (a cloned target repo, never this repo's source); the `api` backend uses
> **structured outputs** for reliable JSON. Delivery + deploy no-op when GitHub isn't configured and
> agent steps no-op (audited `*_skipped`) without credentials — so a true autonomous run just needs an
> `ANTHROPIC_API_KEY` (+ a GitHub repo/token/deploy workflow for real delivery). `docs/OVERVIEW.md` is
> the detailed inventory; the "Decisions" section below tracks what is settled vs. open.

## What we're building

An **autonomous engineering management and delivery tool for a single cross-functional engineering
org unit** — one team/group that owns a slice of the product, not an entire company.

The reference point is [Paperclip](https://paperclipai.net/) (a control plane that runs whole
companies as org charts of AI agents). This project deliberately **narrows the scope to one unit and
goes deeper into the product-development lifecycle and actual delivery**: discovery → design →
architecture → implementation → review → ship. The human operator is the unit's accountable lead
(think EM/Director): they set the mission and goals, govern budgets, approve at gates, and review
output. The agents do the work.

Scope boundary to keep in mind: this is **one unit**, not multi-company portfolio management. Org-wide
concerns (cross-unit dependencies, company strategy) are out of scope except as inputs the human
provides.

## Core domain model

The heart of the system lives in `packages/core` and is framework-agnostic.

**The unit's "headcount" — each role is a persistent agent persona** (prompt + tool set + budget,
defined as data, not hardcoded branches):

| Role | Owns |
| --- | --- |
| **PM** | Discovery, requirements, prioritization, roadmap, acceptance criteria |
| **UX/Design** | Design specs, prototypes, design reviews |
| **Lead Architect** | Architecture decisions/ADRs, tech direction, cross-cutting concerns |
| **Lead System Design** | Concrete system/service/API/data design, interface contracts, scalability |
| **Lead Engineer** | Delivery leadership: decomposes work into tickets, assigns, reviews PRs, unblocks |
| **Staff Engineers (IC, N)** | Implementation: pick up tickets, write code, open PRs, address review |
| **QA/Test** | Test strategy, test authoring, verification of acceptance criteria, the quality gate before `done` |

_Architect vs. System Design:_ the Architect sets macro shape and tech strategy ("what and why");
System Design produces the concrete service/API/data design within that. **QA/Test** owns test
strategy, test authoring, and verification of acceptance criteria; CI enforces quality mechanically,
but the human-style quality gate before a ticket reaches `done` is the QA agent's job.

**Work hierarchy (goal traceability):** `Mission → Goal/Initiative → Epic → Ticket`. Every ticket
traces up to a goal and the unit mission so every agent always has the *why*, not just the *what*.

**Other first-class concepts:** budgets (per role/agent), approval gates (human-in-the-loop), and an
append-only audit log.

## Architecture

pnpm workspaces + Turborepo monorepo (this layout now exists):

```
apps/
  server/        # Orchestration service: HTTP/WS API + heartbeat scheduler
  web/           # React + Vite dashboard (TanStack Router + Query) for the human lead
packages/
  core/          # Domain model + orchestration logic. Framework-agnostic. The heart.
  agents/        # Worker runtime: ClaudeWorker (Anthropic API + `claude -p` CLI backends), pricing
  integrations/  # DeliveryAdapter implementations (git host, CI, issue tracker)
  db/            # Postgres schema + migrations; shared by server
```

Shared zod schemas / TypeScript types live in `core` and are consumed by both `server` and `web`
(no language boundary through the middle of the product — that was the main reason for choosing TS).

### Orchestration model

"Orchestration" here is **three distinct layers** — keep them separate, because each wants a
different tool:

1. **Agent step** — one model+tools reasoning loop (e.g. a Staff Eng agent working a ticket). Owned
   by the **Claude worker** (the default `Worker`: Anthropic API or `claude -p` CLI).
2. **Decisioning** — what to do *next*. The **LLM decides dynamically**; we do **not** author a static
   DAG up front.
3. **Durability** — long-running work that survives restarts, retries, and pauses for human approval.
   Owned by a **durable-execution engine** (see below).

Concretely:

- **Heartbeat scheduler** (in `server`): agents wake on a schedule or on an assignment/event, check
  their queue, act, report, and sleep. Sessions persist across restarts (this is the durability layer).
- **Each agent run is a `Worker` session**: role system prompt + scoped tool set + budget + full
  audit capture. The default `Worker` (`ClaudeWorker`) runs each session via the **Anthropic Messages
  API** (`@anthropic-ai/sdk`, tool-less, with **structured outputs** for JSON steps) or the
  **`claude -p` CLI** (stdio, full Claude Code), selectable by mode (`WORKER_MODE`). Two sandboxed
  roots (never conflated): the CLI backend reasons in a throwaway, **env-scrubbed** agent-state sandbox
  under `workspaces/` (cwd-confined, cleaned up; secrets withheld, only the PM gets a scoped git/gh
  token), and codes against a **persistent working-code workspace** (`workspace/`, env
  `AGENT_CODE_WORKSPACE`) holding cloned target repos — so the agent reads/edits real source while this
  product's own tree is never touched. Override the sandbox root with `AGENT_WORKSPACE_DIR`.
- **The lifecycle is a durable state machine, not a batch DAG.** Stages (`discovery → design →
  architecture → implementation → review → ship`) are *states with human gates*; review can bounce
  work back and blockers loop. The pipeline shape is real, but routing is agent-driven and cyclic.
- **Budgets are enforced centrally** by the orchestrator, not inside the agent.
- **Approval gates** pause work (a durable wait — a Temporal Signal) until the human lead signs off
  (configurable — e.g. roadmap approval, design sign-off, architecture decision, PR merge, deploy).

### Durable-execution engine

The workflow layer needs retries, timeouts, restart-survival, and "pause for days until the human
approves" — i.e. durable execution. **Chosen: Temporal.** Evaluated options (all TS-native):

| Option | Verdict |
| --- | --- |
| **Temporal** | **✅ Chosen.** Fully open source (**MIT**), the most battle-tested durable-workflow engine; official TS SDK; **Signals/Timers map directly onto our approval gates and heartbeats**. Cost is operational — run a Temporal cluster + a backing DB (Postgres) and operate it — which we accept for the durability and license clarity. |
| **Inngest** | Considered. Best DX and incremental adoption (`waitForEvent`, "just functions"), and self-hostable — but the server is **SSPL** (source-available, not OSI open source). Ruled out on license purity. |
| **pg-boss** | Considered (minimal). MIT Postgres-backed job queue, no extra service. Rejected because durability/retries/approval-waits would be hand-rolled — we want the engine to *own* durability, not `core`. |

**Deliberately NOT used** (don't re-litigate or reach for these):
- **Dagster / Prefect** — Python-first (conflicts with the TS stack and the no-Python preference) and
  built for *deterministic scheduled data DAGs*, not dynamic agent-driven routing. Wrong paradigm.
- **LangChain** as an orchestrator — overlaps the Claude worker's own agent loop (two agent loops) and pulls in a
  provider-agnostic abstraction we don't want as a Claude-first project. (`LangGraph.js` is the only
  piece worth revisiting *if* we later want explicitly graph-structured multi-agent control flow.)

### Delivery loop (hybrid)

Ticket lifecycle: `backlog → planned → in_progress → in_review → deploying → done | blocked`.

Build the full loop's *interface* now, ship *coordination* first. A `DeliveryAdapter` abstracts the
git host, CI, and issue tracker; the **first implementation targets GitHub** (PRs, checks/Actions, and
GitHub Issues/Projects as the likely initial tracker). Plan/assign/track/report works without it. The
`ticket → branch/PR → CI → review → merge` path is **now wired in the Temporal `ticketLifecycle`
workflow** behind the adapter (the activities build it from `GITHUB_*` env and no-op when unset);
the coding agent now writes file changes that are committed to the branch (Git Data API) before the
PR opens, and a human-gated deploy dispatches a GitHub Actions workflow (`workflow_dispatch`) on the
ship step, polling the run to completion — all without reworking `core`.

## Key invariants (the "big picture" that spans files)

1. **Goal traceability is enforced in `core`** — no work item exists without a parent goal; the chain
   is injected into every agent's context.
2. **The audit log is append-only.** Every agent tool-call and decision is recorded; the dashboard is
   a *read view* over it. Never mutate history.
3. **Budgets are enforced by the orchestrator**, so a `Worker` cannot exceed its budget even if its
   own prompt tells it to. Budgets are monthly-windowed (lazy reset) and held via an atomic
   reserve→reconcile so concurrent runs can't jointly overspend.
4. **The human is in the loop at configured gates.** Agents *request approval and block* — they do
   not bypass a gate. Each pending gate is a first-class persisted approval record, resolved with the
   deciding principal's identity. The HTTP API is auth-gated (bearer token when `API_AUTH_TOKEN` is set).
5. **Cross the boundaries through interfaces only.** `core` never calls the Claude SDK directly — it
   goes through `Worker`; likewise delivery goes through `DeliveryAdapter` and tracking through the
   tracker interface. Swapping a runtime or git host must not touch `core`.
6. **Roles are config, not code.** Adding or changing a role is a data/prompt change, not an edit to
   the orchestrator.

## Stack & conventions

- **TypeScript strict**, ESM throughout.
- **pnpm** workspaces + **Turborepo** for the monorepo task graph.
- **Hono** for the HTTP/WS API in `apps/server`.
- **Postgres** for state + audit; **Drizzle** for schema/migrations (TS-native types end-to-end).
- **Temporal** (self-hosted, MIT) for the durable workflow layer (see Orchestration).
- **zod** for validation; schemas shared from `core`.
- **Vitest** for tests; **Biome** for lint + format.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) runs typecheck/lint/test/build on every PR to `main`.

## Commands

Top-level scripts (wired and verified):

```bash
pnpm install
pnpm dev                 # turbo run dev across apps
pnpm build               # turbo run build
pnpm typecheck
pnpm lint                # biome
pnpm test                # all tests (Vitest)
pnpm test <path>         # single file
pnpm vitest -t "<name>"  # single test by name
pnpm db:generate         # drizzle-kit: generate migration from schema
pnpm db:migrate          # drizzle-kit: apply migrations

# Full local stack (Postgres + Temporal + Temporal UI + server + worker + web):
docker compose up -d     # or: pnpm docker:up
docker compose down      # or: pnpm docker:down
```

> Migrations run automatically: a one-shot `migrate` service applies `drizzle-kit migrate` once
> Postgres is healthy, and `server` + `worker` gate on it via `service_completed_successfully`, so
> `docker compose up` is migrations-included. To run them standalone: `docker compose run --rm migrate`.
> (`migrate`, `server`, and `worker` share one built image, `engineering/app:local`.)

## Decisions

**Settled:**
- **Stack:** TypeScript/Node monorepo (pnpm + Turborepo); no Python.
- **Scope:** one cross-functional engineering unit, full product-development lifecycle (not multi-company).
- **Roles (7):** PM · UX/Design · Lead Architect · Lead System Design · Lead Engineer · Staff Engineers (IC) · QA/Test.
- **API framework:** Hono. **Lint/format:** Biome. **Tests:** Vitest. **DB:** Postgres + Drizzle. **Validation:** zod.
- **Orchestration:** Claude worker — Anthropic API + `claude -p` CLI (agent step) + **Temporal** (self-hosted, MIT) for the durable
  workflow layer; state machine, not a DAG. **Not** Dagster/Prefect/LangChain/Inngest/pg-boss (see
  Orchestration for why).
- **Delivery:** first `DeliveryAdapter` targets **GitHub**; hybrid rollout (coordination first,
  delivery loop behind the adapter).
- **Web dashboard:** **React + Vite** (code-based TanStack Router + TanStack Query). A SPA over the
  Hono API — no second server, keeping the `core` boundary clean. (Not Next.js: its server/RSC model
  would duplicate `apps/server` and tempt direct DB access from the UI.)
- **Persistence:** pluggable ports in `core` (`IssueTracker` · `KnowledgeBase` · `Hierarchy` ·
  `AuditLog` · `DecisionLog`) + a factory (`createPersistence`/`persistenceFromEnv`) selected by
  `PERSISTENCE_BACKEND` = `github` | `postgres`. GitHub backend = Issues + repo-docs KB (Contents
  API; Wikis have no API) + the mission→goal→epic hierarchy as native GitHub **sub-issues**;
  audit + the decision-graph index stay in Postgres (the decision **body** is written to the KB, so
  it's PR-reviewable on the GitHub backend — ENG-014). Swapping backends never touches `core` or the workflow.
- **Issue tracker:** **GitHub Issues/Projects** as the v1 default (Postgres backend for
  local/standalone); Linear/Jira deferred behind the same `IssueTracker` port (decided in ENG-011).
- **CI:** GitHub Actions — typecheck/lint/test/build on every PR to `main`.
- **API auth:** bearer-token middleware on mutating routes (activates when `API_AUTH_TOKEN` is set);
  the deciding principal is recorded as `decidedBy` on approvals.
- **Evaluated & declined:** **A2A** (Google agent-to-agent) — monitor, not adopted; internal
  coordination is already handled by Temporal, so A2A is only relevant at the unit boundary and would
  live behind a port (ENG-012). **SurrealDB** as the datastore — no-go: it wouldn't remove Postgres
  (Temporal needs it) and BSL is source-available, not OSI; Postgres + Drizzle stays (ENG-015).

**Working assumptions (confirm or redirect):**
- _Agent runtime:_ Claude-first — `ClaudeWorker` (Anthropic API + `claude -p` CLI backends) as the default `Worker`, pluggable behind the interface.
- _Interface:_ API-first core + self-hosted web dashboard; human = accountable lead with approval gates.

**Still open:**
- _API auth posture:_ auth is opt-in (activates with `API_AUTH_TOKEN`) and GET read views are open —
  whether to require-by-default and protect reads is an operator hardening decision.
- _License bar:_ whether to ever relax the OSI-only stance (e.g. to accept BSL) — recommended **no**
  absent a concrete need.
