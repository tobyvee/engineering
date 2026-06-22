# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Status: skeleton + first vertical slice.** The pnpm + Turborepo monorepo passes
> `typecheck`/`lint`/`test`. A real end-to-end slice works against Postgres + Temporal: create a
> ticket → a durable workflow advances it `planned → in_progress → in_review`, blocks at a human
> approval gate (a Temporal Signal), then completes on approval — every transition persisted and
> appended to the audit log, with the Mission→Goal→Epic chain seeded for traceability. The Claude
> worker is implemented — `runAgentStep` runs `ClaudeWorker` (Anthropic API or `claude -p` CLI
> backends) within budget and records the result. The GitHub `DeliveryAdapter` is implemented
> (branches, PRs, checks, merge via octokit); wiring it into the durable workflow — the
> `ticket → branch → PR → CI → merge` loop — is the remaining step.
> Sections marked _(target)_ describe intended behavior not yet wired; the "Decisions" section tracks
> what is settled vs. still open.

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
  API** (`@anthropic-ai/sdk`) or the **`claude -p` CLI** (stdio), selectable by mode (`WORKER_MODE`).
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

Ticket lifecycle: `backlog → planned → in_progress → in_review → done | blocked`.

Build the full loop's *interface* now, ship *coordination* first. A `DeliveryAdapter` abstracts the
git host, CI, and issue tracker; the **first implementation targets GitHub** (PRs, checks/Actions, and
GitHub Issues/Projects as the likely initial tracker). Plan/assign/track/report works without it; the
`ticket → coding-agent → branch/PR → CI → review → merge → deploy` path plugs in behind the adapter
later without reworking `core`.

## Key invariants (the "big picture" that spans files)

1. **Goal traceability is enforced in `core`** — no work item exists without a parent goal; the chain
   is injected into every agent's context.
2. **The audit log is append-only.** Every agent tool-call and decision is recorded; the dashboard is
   a *read view* over it. Never mutate history.
3. **Budgets are enforced by the orchestrator**, so a `Worker` cannot exceed its budget even if its
   own prompt tells it to.
4. **The human is in the loop at configured gates.** Agents *request approval and block* — they do
   not bypass a gate.
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

**Working assumptions (confirm or redirect):**
- _Agent runtime:_ Claude-first — `ClaudeWorker` (Anthropic API + `claude -p` CLI backends) as the default `Worker`, pluggable behind the interface.
- _Interface:_ API-first core + self-hosted web dashboard; human = accountable lead with approval gates.

**Still open:**
- _Initial issue tracker:_ GitHub Issues/Projects vs. external (Linear/Jira) behind the same interface.
