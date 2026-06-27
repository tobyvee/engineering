# ENG-015 — Evaluate SurrealDB as a persistence backend (decision spike)

- **Status:** done (decision recorded; one item awaits the lead's ratification — see below)
- **Priority:** P2 (Medium — decision spike; gates a potentially large change)
- **Stage:** discovery → architecture
- **Assignee role:** lead_architect (tech direction / cross-cutting) with lead_system_design
- **Area:** packages/core (ports) · packages/db · packages/integrations · infra

## Decision (Wave 0 spike outcome)

**No-go on a wholesale "store everything in SurrealDB" replacement.** Two independent blockers, either
of which is sufficient:

1. **It doesn't consolidate the stack.** Temporal needs a supported backing store (PostgreSQL / MySQL /
   Cassandra / SQLite); SurrealDB is not one. So Postgres stays regardless — this is *additive*
   infrastructure, not the one-datastore simplification it appears to be.
2. **It requires relaxing the project's license bar.** SurrealDB core is **BSL 1.1** — source-available
   but **not** OSI open source, the same category the project used to reject Inngest (SSPL) "on license
   purity." In practice BSL's only restriction (no competing managed DBaaS) would never bind a
   self-hosted internal tool, so it's far milder than SSPL — but adopting it is a conscious reversal of
   a settled decision.

**Conditional future option (deferred):** add a `surreal` backend behind the existing
`PERSISTENCE_BACKEND` ports as a *narrow pilot* (the ENG-014 decision graph — the most graph-shaped,
highest-upside feature), **only if both** (a) the lead consciously relaxes the OSI-only license bar to
accept BSL, **and** (b) graph/lineage queries become central enough to justify a second datastore.
SurrealDB's multi-model fit (relational + document + native graph) and "AI agent memory" positioning
make it a genuinely strong technical candidate *for that pilot* if those conditions are met.

**Action now:** keep Postgres + Drizzle as the default and as Temporal's store. Build **ENG-014 on the
Postgres + KB hybrid behind its port**, so a later migration to a `surreal` backend (if the pilot ever
runs) needs no `core` changes.

**Awaiting the lead's ratification:** the one decision the spike can't make unilaterally — *do we relax
the OSI-only license bar to accept BSL 1.1?* Recommendation: **keep the bar (decline) for now**, since
no current need exists that Postgres can't meet. Revisit only alongside a concrete graph-query need.

## Question

Should this project store its state in **SurrealDB** — potentially "everything" — instead of / in
addition to Postgres? This ticket evaluates that and produces a go/no-go, rather than committing to a
big-bang migration. The trigger is that the project's data is naturally multi-model: the
Mission→Goal→Epic→Ticket hierarchy and the ENG-014 decision DAG are **graph-shaped**, the KB artifacts
are **document-shaped**, and tickets/budgets are **relational** — all three of which SurrealDB handles
in one engine.

## Verified findings (June 2026)

- **License: BSL 1.1.** Free to use, embed, and self-host internally at any scale; the only
  restriction is offering SurrealDB itself as a managed DBaaS. Each release converts to Apache 2.0
  four years after launch (3.0 → Apache 2.0 on 2030-01-01). **Source-available, but not OSI-approved
  open source.**
- **Maturity:** SurrealDB 3.0 reached GA on 2026-02-17, with a $23M raise and enterprise users;
  explicitly positioned as a database for **"AI agent memory"** — this project's domain.
- **Model:** multi-model (relational + document + graph) with native `RELATE` edges, `->` graph
  traversal, and live queries (real-time subscriptions).

## Why it's attractive here

- One engine natively covers the hierarchy (graph), the decision DAG (graph — ENG-014), the KB
  (document), and tickets/budgets (relational) — no recursive-CTE / FK-join gymnastics for traversal.
- Live queries could drive the dashboard read-views without polling.
- "AI agent memory" positioning aligns with the KB / decision-log / provenance direction.

## Why NOT a wholesale replacement (the hard constraints)

1. **It does not remove Postgres.** Temporal — the chosen durable engine — needs its own backing store
   and supports only PostgreSQL / MySQL / Cassandra / SQLite. **SurrealDB is not a Temporal
   persistence option.** So "everything in SurrealDB" still leaves Postgres running under Temporal;
   this is "add a store," not "remove one."
2. **License-purity tension.** BSL 1.1 is source-available but **not OSI open source** — the same
   top-line category the project used to reject Inngest ("SSPL … ruled out on license purity"). In
   practice BSL's restriction (no competing DBaaS) will never bind a self-hosted internal tool, so it
   is far milder than SSPL — but adopting it means **consciously relaxing the OSI-only bar** the
   project set. This needs an explicit, recorded decision.
3. **Cost of leaving Postgres+Drizzle.** Loses TS-native query types end-to-end, the Drizzle migration
   tooling (`0000`–`0002`), and Postgres operational maturity, for a DB whose current major version is
   months old.

## Recommended approach (don't big-bang)

Use the seam that already exists — the pluggable `core` persistence ports
(`IssueTracker` · `KnowledgeBase` · `Hierarchy` · `AuditLog`) selected by `PERSISTENCE_BACKEND`
(`postgres` | `github`). Add a **`surreal`** backend implementing those ports (plus the `DecisionLog`
port from ENG-014) **behind the same factory** — `core` and the workflow stay untouched (invariant
#5). Pilot with **ENG-014's decision graph** (most graph-shaped, highest upside), compare against the
Postgres+KB hybrid, then decide on broader adoption. Keep `postgres` as default and as Temporal's
backing store regardless.

## Acceptance criteria

- [ ] An explicit, recorded license decision: does the project relax its OSI-only bar to accept BSL
      1.1? (Documented in CLAUDE.md / OVERVIEW with rationale, alongside the Inngest rejection.)
- [ ] Confirmation in writing that Temporal continues to run on a supported store (Postgres) — i.e.
      SurrealDB is additive to the stack, not a replacement of it.
- [ ] A `surreal` backend implementing at least `KnowledgeBase` + the ENG-014 `DecisionLog` port,
      selectable via `PERSISTENCE_BACKEND`, without touching `core` or the workflow.
- [ ] A written comparison (modelling fit, query ergonomics for the hierarchy + decision DAG, types
      story, ops/backup, maturity) vs. the Postgres+Drizzle baseline.
- [ ] A go/no-go recommendation on broader adoption (decision-log only · all agent state · not now),
      with rejected alternatives recorded in the project's decision log.

## Notes / risks

- Pilot scope is deliberately the decision graph (ENG-014), not the whole persistence layer — keeps
  the spike cheap and reversible.
- If go: budgets and the lifecycle's transactional writes need careful thought (cross-store
  transactions between SurrealDB and Temporal/Postgres are not atomic).
- If no-go: the Postgres+KB hybrid in ENG-014 stands; this ticket still leaves a recorded decision.

## Sources

- SurrealDB license FAQ — https://surrealdb.com/license
- SurrealDB licensing repo — https://github.com/surrealdb/license
- SurrealDB 3.0 GA / "AI agent memory" — https://surrealdb.com/blog/introducing-surrealdb-3-0--the-future-of-ai-agent-memory
