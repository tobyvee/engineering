# ENG-014 — Per-agent decision logs & a traceable decision tree

- **Status:** done
- **Priority:** P2 (Medium — governance / explainability)
- **Stage:** architecture → implementation
- **Assignee role:** lead_system_design (schema + storage port) with lead_architect sign-off
  (cross-cutting concern)
- **Area:** packages/core (schema + port) · packages/db · packages/integrations · apps/server
  (emit on each step) · apps/web (optional view)

## Problem

Every agent should emit a structured **decision log** — what it decided, why, what alternatives it
weighed, what it consumed and produced — and those logs should link into a **decision graph that is
traceable all the way up to the original request**. Today agents emit only a free-text `summary`, the
audit log is a flat event stream, and the work hierarchy traces *work items* (not decisions and their
rationale). There is no queryable, linked provenance of *why* the unit did what it did.

This is the same "make an implicit thing first-class" pattern as ENG-006 (approvals), applied to
decision provenance.

## What this is (and is not)

- **Not** a replacement for the append-only audit log (`AuditLog` port / `auditLog` table) — that
  stays the event substrate ("what happened, when, cost"). Decisions *reference* audit events; they do
  not duplicate them (invariant #2).
- **Not** the work hierarchy — Mission→Goal→Epic→Ticket gives the work-item spine; decisions hang off
  it and off each other.
- **It is** a semantic layer linking decision → parent decision(s) → work item → original request.
- **It is a DAG, not a strict tree:** a decision can build on several prior decisions (e.g. System
  Design depends on both PM requirements and the Architect ADR). Model parents as a set of edges.

## Evidence / context

- `packages/core/src/schema.ts` — `AuditEvent` (flat stream) and the Mission/Goal/Epic/Ticket schemas
  (work-item traceability, invariant #1). No decision/provenance entity exists.
- `packages/db/src/repo.ts` — `getTraceContext` / `getEpicContext` already walk the hierarchy to root;
  the decision graph reuses this spine.
- `apps/server/src/temporal/activities.ts` — `runShapingStage`, `decomposeEpic`, `implementTicket`,
  `verifyTicket` each currently record a free-text `summary` in the audit payload; these are the
  emit points for structured decisions.
- `packages/core/src/knowledge.ts` (+ GitHub/DB KB impls) — the existing document substrate for
  artifact bodies (shaping artifacts already stored this way).

## Storage — options & recommendation

Anchor on what exists: the append-only audit log + the hierarchy spine. The decision graph is a layer
on top of them.

| Option | Pros | Cons |
|--------|------|------|
| **A. Relational** (Postgres `decisions` table: self-ref `parent_decision_id` edges + FKs to work item + `root_request_id`; rationale in JSONB; recursive CTE to root) | Already the system of record; FK integrity; transactional; append-only; Drizzle in use | Graph traversal via recursive CTE (fine at this scale) |
| **B. Document store** (existing `KnowledgeBase` port — Postgres `kb_docs` or GitHub repo docs; one doc per decision) | Human-readable; on the GitHub backend decisions become **PR-reviewable files next to the code**; reuses the KB port | Weak tree/query layer — parent links in frontmatter, graph rebuilt in app code; no integrity |
| **C. Graph DB** (Neo4j, …) | Native lineage traversal | New infra + ops burden; against the lean-Postgres stack decision; overkill — **not now** |
| **D. SurrealDB** (multi-model: relational + document + **graph** in one engine; native `RELATE` edges + `->` traversal; live queries) | Best technical fit for this DAG *and* the work hierarchy *and* the KB body — all in one store; pitched explicitly for "AI agent memory" | BSL 1.1 (source-available, **not** OSI — see ENG-015 license note); does not remove Postgres (Temporal still needs it); loses Drizzle/TS-native types; new datastore. Being evaluated separately — **see ENG-015** |

**Recommendation — hybrid (A as the index, B for the body):** store the **decision node + edges**
(structure, refs, parent links, `root_request_id`) as **append-only rows in Postgres** for queryable,
integrity-checked traversal; store the **rich rationale body** inline as JSONB or as a KB document
referenced by path (human-readable, and PR-reviewable on the GitHub backend). Put it behind a new
`core` port (e.g. `DecisionLog` / `ProvenanceGraph`, alongside `AuditLog` / `Hierarchy`) so backends
stay pluggable (invariant #5). Do **not** stand up a graph DB.

**Modeling lens:** this is structurally an OpenTelemetry trace — `root_request_id` ≈ trace id, each
decision ≈ a span with a `parent_decision_id`. Keep field names trace-compatible so the graph could
later be emitted to a tracing/observability backend without remodeling.

> If the SurrealDB evaluation (ENG-015) goes ahead, this feature is the natural **pilot**: it is the
> most graph-shaped, highest-upside use case. The `DecisionLog` port keeps the body backend-agnostic,
> so it can land on the Postgres+KB hybrid first and move to a `surreal` backend later without
> reworking the schema.

## Proposed decision-node schema (sketch)

- `id`
- `rootRequestId` — the originating human request / workflow kickoff (the root every chain reaches)
- `parentDecisionIds[]` — causal parents (DAG edges)
- work-item refs: `missionId` / `goalId` / `epicId` / `ticketId` (the hierarchy spine)
- `actor` (RoleId / agent), `stage` (LifecycleStage), `at`
- `statement` (what was decided), `rationale` (why)
- `alternatives[]` (considered + why rejected)
- `inputs` (artifacts / prior decisions / files consumed)
- `outputs` (KB doc paths, file changes, PR, created ticket ids)
- `confidence`, `costCents`
- `auditEventId` — link back to the audit-log event substrate

## Proposed approach

1. Add a `Decision` zod schema in `core` and a `DecisionLog` port (`record`, `get`,
   `listByRoot` / `byWorkItem`, `traverseToRoot`), with Postgres + GitHub-doc implementations.
2. Establish a **root request node** at each kickoff (epic shaping / roadmap authoring / workflow
   start) capturing the human's original ask.
3. Have each agent step emit a structured decision via **structured outputs (ENG-009)** — shaping
   draft, decomposition, implementation, QA verdict — linked to its parent decision(s) and work item.
4. Keep it append-only; reference (don't copy) audit events and KB artifacts.
5. (Optional) a dashboard decision-tree view (ENG-010 adjacent).

## Acceptance criteria

- [ ] Every agent step (shape / decompose / implement / QA) emits a structured decision record linked
      to its parent(s) and its work item.
- [ ] Each decision chains via parent edges + the work hierarchy to the **original request** (root),
      and this is verifiable by a traversal API.
- [ ] A `core` `DecisionLog` port persists decisions, is backend-pluggable (Postgres + GitHub-doc),
      and is append-only.
- [ ] Decision bodies are human-readable (and PR-reviewable on the GitHub backend).
- [ ] Decisions reference audit events / KB artifacts rather than duplicating them.

## Notes / risks

- **Enabled by ENG-009** — without structured outputs, extracting decisions from prose is brittle.
- It is a **DAG, not a strict tree** — support multiple parents.
- Keep field names OpenTelemetry-trace-compatible to allow later emit to a tracing backend.
- Same first-class-entity pattern as ENG-006 (approvals); a natural dashboard view pairs with ENG-010.
