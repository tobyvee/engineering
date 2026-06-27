# engineering

**An autonomous engineering-management & delivery tool for a single cross-functional engineering org unit** — a persistent org of role-based AI agents that takes work from a one-line epic all the way to a shipped change, with the human as the accountable lead at the approval gates.

[![CI](https://github.com/tobyvee/engineering/actions/workflows/ci.yml/badge.svg)](https://github.com/tobyvee/engineering/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict%2C%20ESM-3178c6)
![Temporal](https://img.shields.io/badge/durable-Temporal-000)
![Claude](https://img.shields.io/badge/agents-Claude-d97757)

The reference point is [Paperclip](https://paperclipai.net/) (a control plane that runs whole companies as org charts of AI agents). This project deliberately **narrows the scope to one unit and goes deeper into the product-development lifecycle and actual delivery**: discovery → design → architecture → implementation → review → ship. You set the mission and goals, govern budgets, and approve at the gates; the agents do the work.

> **Status:** the full lifecycle is implemented and **all 16 tickets across Waves 0–4** in [`project/`](./project) are complete — including a per-agent **decision-provenance DAG** (ENG-014) and **Kappa-style direction consensus** (ENG-016). It has been **validated end-to-end on a live model**: a ticket ran shape → decompose → implement → QA → merge → deploy to `done` with real committed, QA-verified, merged code, fully offline (`DELIVERY_BACKEND=local`, no GitHub). It runs as durable Temporal workflows against Postgres, with all seven roles driving a stage behind the human gates. `typecheck` · `lint` · `test` (144) · `build` are green and CI-gated on every PR. Agent steps no-op (audited) without credentials, so a real autonomous run needs only an `ANTHROPIC_API_KEY` (or the `claude` CLI). It's a working system built as a focused exploration, not a hosted product.

## The pipeline

```
Epic-level (agent planning, durable Temporal workflows):
  epic → SHAPE (PM discovery → UX design → Architect ADR → System Design)
       → [roadmap sign-off] → DECOMPOSE (Lead Engineer → backlog tickets, informed by the artifacts)

Per ticket (durable lifecycle):
  ticket → implement (Staff Eng codes against the cloned repo) → branch + commit → PR → CI
         → QA (verify acceptance criteria; fail → bounded rework loop) → [merge gate] → merge
         → deploying → [deploy gate] → GitHub Actions deploy → done
```

Every transition is persisted and appended to an append-only audit log (the dashboard is a read view over it), every work item traces up the `Mission → Goal → Epic → Ticket` chain, and per-role budgets are enforced centrally. Every agent step also emits a structured **decision** into a provenance DAG traceable back to the originating request (ENG-014), and an optional **Kappa-style consensus** step (ENG-016) can have the senior technical roles independently rate candidate directions before implementation, gated by an inter-rater agreement coefficient with a human tie-break.

## The team

Each role is a **persistent agent persona** — a prompt + tool set + budget defined as data, not hardcoded branches. Adding or changing a role is a config edit.

| Role | Owns |
| --- | --- |
| **PM** | Discovery, requirements, prioritization, acceptance criteria |
| **UX / Design** | Design specs, prototypes, design reviews |
| **Lead Architect** | Architecture decisions / ADRs, tech direction |
| **Lead System Design** | Concrete service / API / data design, interface contracts |
| **Lead Engineer** | Decomposes epics into tickets, reviews PRs, unblocks |
| **Staff Engineers (IC)** | Implementation: pick up tickets, write code, open PRs |
| **QA / Test** | Test strategy, verification — the quality gate before `done` |

**Three human gates** (the lead signs off): **roadmap** (before an epic is decomposed into tickets), **merge** (before a PR lands), and **deploy** (before a ship) — plus an optional **architecture** gate that resolves a low-agreement consensus round (ENG-016).

## How it works

Orchestration is three distinct layers, each with the right tool:

1. **Agent step** — one model + tools reasoning loop, owned by `ClaudeWorker` (Anthropic Messages API **or** the `claude -p` CLI, selectable by `WORKER_MODE`).
2. **Decisioning** — the LLM decides what to do next; there's no static DAG.
3. **Durability** — long-running work that survives restarts, retries, and pauses-for-approval, owned by **Temporal** (self-hosted, MIT). Approval gates are Temporal **Signals**; the heartbeat is a Temporal **Schedule**.

The lifecycle is a **durable state machine, not a batch DAG** — review can bounce work back, blockers loop, and gates pause work for days until a human signs off.

## Monorepo layout

```
apps/
  server/   # Hono HTTP/WS API + Temporal worker/workflows/activities + heartbeat
  web/      # React + Vite dashboard (TanStack Router + Query): Board · Roadmap · Approvals · Budgets · Audit
packages/
  core/     # Domain model, zod schemas, and the ports (Worker · DeliveryAdapter · IssueTracker ·
            #   KnowledgeBase · Hierarchy · AuditLog). Framework-agnostic — the heart.
  agents/   # Agent runtime: ClaudeWorker (api + cli backends), proposeFileChanges / proposeTickets /
            #   draft / assess, pricing, prompt builder
  integrations/ # GitHub adapters (delivery + issues + KB + native sub-issue hierarchy)
  db/       # Postgres schema + Drizzle migrations
```

**Pluggable persistence** behind `core` ports, selected by `PERSISTENCE_BACKEND`:

| Port | `postgres` | `github` |
| --- | --- | --- |
| Work items | `DbIssueTracker` | GitHub **Issues** (fields round-tripped in a metadata block) |
| Knowledge / docs | `kb_docs` table | repo Markdown via the Contents API |
| Goal hierarchy | `mission→goal→epic` rows | native GitHub **sub-issues** |
| Audit log | Postgres (append-only) | Postgres |

Swapping a backend never touches `core` or the workflow.

## Stack

TypeScript (strict, ESM) · pnpm + Turborepo · **Hono** (API) · **Postgres + Drizzle** · **Temporal** (durable workflows) · **zod** (validation) · **React + Vite + TanStack** (dashboard) · **Biome** (lint/format) · **Vitest** (tests).

## Quick start

```bash
pnpm install
cp .env.example .env

# Full local stack — Postgres + auto-migrate + Temporal + UI + server + worker + web:
docker compose up -d
```

- Dashboard: http://localhost:5173 · API health: http://localhost:3000/health · Temporal UI: http://localhost:8080

Or run against local infra directly:

```bash
pnpm dev
```

### Running with real agents

By default the agent steps need credentials; without them they no-op and record a `*_skipped` audit event (delivery/deploy likewise no-op when GitHub is unconfigured) — so the durable pipeline still runs end to end.

- **`api` backend** (`ANTHROPIC_API_KEY`) — a single Messages API call per step with **structured outputs** for reliable JSON; **no tools, no side effects**. The lean, deterministic path.
- **`cli` backend** (`WORKER_MODE=cli`) — shells out to `claude -p` using the local CLI's own auth (no API key). It's the full Claude Code agent, run across **two sandboxed roots**: a throwaway **env-scrubbed** agent-state sandbox under `workspaces/` (host secrets withheld; only the PM gets a scoped `git`/`gh` token) and a persistent **working-code workspace** (`workspace/`) holding the cloned target repo — so coding agents read and edit real source while this repo's own tree is never touched.

GitHub delivery (branch/PR/CI/merge) and the Actions deploy activate when `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` (and a deploy workflow) are set.

## Common commands

```bash
pnpm dev          # turbo run dev
pnpm build
pnpm typecheck
pnpm lint         # biome
pnpm test         # vitest
pnpm db:generate  # drizzle-kit generate
pnpm db:migrate   # drizzle-kit migrate
```

## Continuous integration

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs `typecheck` · `lint` · `test` · `build`
on every pull request to `main` (and on pushes to `main`), using the Node version pinned in `.nvmrc`
with a frozen lockfile and pnpm + Turborepo caching. Unit tests need no live services.

To make a failing check **block merges**, enable branch protection on `main`
(GitHub → Settings → Branches → Add rule) and mark the **`typecheck · lint · test · build`** status
check as required. This is a one-time repo setting and can't be committed from the codebase.

## Key invariants

1. **Goal traceability** is enforced in `core` — no work item exists without a parent goal; the chain is injected into every agent's context.
2. **The audit log is append-only** — the dashboard is a read view; history is never mutated.
3. **Budgets are enforced by the orchestrator** (monthly-windowed, held via an atomic reserve→reconcile), so an agent can't exceed its budget even if its own prompt says to.
4. **The human is in the loop at configured gates** — agents request approval and block; each pending gate is a first-class persisted record resolved with the approver's identity, and the HTTP API is auth-gated (bearer token when `API_AUTH_TOKEN` is set).
5. **Cross boundaries through interfaces only** — `core` never calls the Claude SDK, a git host, or a tracker directly.

## Docs

- [`CLAUDE.md`](./CLAUDE.md) — north-star architecture, the orchestration model, and the full decisions log (settled vs. open).
- [`docs/OVERVIEW.md`](./docs/OVERVIEW.md) — a snapshot inventory of everything built, with verification notes.
- [`project/`](./project) — the delivered backlog (16 tickets), [PRD-001](./project/PRD-001-kappa-consensus.md) (Kappa consensus), and the [ROADMAP](./project/ROADMAP.md).

## License

[MIT](./LICENSE) © Toby V
