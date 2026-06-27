# Implementation roadmap

Recommended order for the [tickets](README.md), derived from their dependencies, priorities, and
leverage. Ordering principles, in order: **(1)** foundations that de-risk everything first; **(2)**
respect hard dependencies; **(3)** the two P0 "before a live run" concerns early; **(4)** pull
high-leverage enablers forward even when labelled P1/P2.

## Dependency map (B must precede A)

- **ENG-001** ← ENG-013, ENG-009, ENG-005
- **ENG-013** ← ENG-005
- **ENG-006** ← ENG-004
- **ENG-010** ← ENG-007
- **ENG-008** ← ENG-007, ENG-002
- **ENG-014** ← ENG-009, (ENG-015 *decision*)
- **ENG-016** ← ENG-009, ENG-002, ENG-014
- Roots (no inbound deps): ENG-002, ENG-003, ENG-004, ENG-005, ENG-007, ENG-009, ENG-011, ENG-012, ENG-015

## Waves (items within a wave parallelise)

### Wave 0 — Foundations — ✅ complete (2026-06-27)
- **ENG-003** ✅ — CI for this repo (`.github/workflows/ci.yml`; badge + branch-protection note).
- **ENG-002** ✅ — Temporal workflow test harness (8 tests via `@temporalio/testing`; 59 total green).
- *Discovery (decisions recorded in the tickets):* **ENG-012** ✅ (A2A — decline now, monitor, keep
  port-shaped), **ENG-011** ✅ (tracker — GitHub Issues default; Postgres for local), **ENG-015** ✅
  (SurrealDB — no-go on wholesale replacement; one item awaits the lead: relax the OSI-only license
  bar? recommended *no* for now).

### Wave 1 — Safety + enablers (independent, high-leverage) — ✅ complete (2026-06-27)
- **ENG-004** ✅ — API auth + approval identity (bearer token on mutating `/api/*`; principal stamped
  on `approval_decided` audit events; dev-mode warn when unset).
- **ENG-009** ✅ — Structured outputs (API backend emits `output_config.format`; hand-written schemas;
  parse-failure vs empty-set audited distinctly).
- **ENG-005** ✅ — Scrub the CLI sandbox env (allow-listed `sandboxEnv()`; host secrets withheld).

### Wave 2 — Repo-context critical path — ✅ complete (2026-06-27)
- **ENG-013** ✅ — Two-root workspace + PM `git`/`gh` grant + PM-scoped token + idempotent
  `ensureRepoCloned`, wired+audited in `implementTicket`. (Deferred: literal `--allowedTools` gating;
  per-epic repo association.)
- **ENG-001** ✅ — `WorkerInput.workdir`; CLI backend runs in the cloned repo cwd so agents read/edit
  real source. (Deferred: API-backend file-context injection.)

### Wave 3 — Governance / observability — ✅ complete (2026-06-27)
- **ENG-007** ✅ — Monthly reset (`period_start`, lazy rollover) + atomic reserve/reconcile across all
  agent activities.
- **ENG-006** ✅ — First-class persisted approvals (added `epic_id`); pending records per gate,
  resolved with `decidedBy`; `/api/approvals` covers roadmap · merge · deploy.
- **ENG-010** ✅ — `/api/budgets` + web Budgets page (per-role limit/spent/remaining + total).
- **ENG-008** ✅ — Bounded implement→review→QA rework loop with QA feedback, then blocked.

### Wave 4 — Provenance + consensus ✅
- **ENG-014** ✅ — Decision log / provenance DAG on the Postgres+KB hybrid behind a `DecisionLog` port;
  every agent step (shape/decompose/implement/QA) emits a decision traceable to the originating request.
- **ENG-016** ✅ — Kappa-style consensus (PRD-001), Phase 1: advisory `directionConsensus` workflow —
  candidate generation → parallel independent raters → Krippendorff/Fleiss/Kendall agreement + Borda →
  human-escalation tie-break via the `architecture_decision` gate; outcomes feed the decision log.

## Critical path (to a safe, useful autonomous run)

```
ENG-003/002  →  ENG-009 + ENG-005 + ENG-004  →  ENG-013  →  ENG-001
(foundations)        (Wave 1)                   (Wave 2 — usable code)
```

Everything else branches off the sides of this spine. Minimum viable sequencing: Wave 0 → Wave 1; add
Wave 2 to make autonomous runs produce usable code.

## Single-threaded sequence (if not parallelising)

1. ENG-003 · 2. ENG-002 · 3. ENG-004 · 4. ENG-009 · 5. ENG-005 · 6. ENG-013 · 7. ENG-001 ·
8. ENG-007 · 9. ENG-006 · 10. ENG-010 · 11. ENG-008 · 12. ENG-015 · 13. ENG-014 · 14. ENG-016

(ENG-011 and ENG-012 slot in as parallel discovery whenever there's slack.)

## Ordering flags

1. **ENG-005 (P1) gates a P0.** ENG-013 depends on it — treat it as Wave 1, not "later with the P1s."
2. **ENG-009 is the highest-leverage single item.** P1, but unlocks a P0 (ENG-001 quality) plus ENG-014
   and ENG-016 — pulling it early is the biggest momentum multiplier.
3. **Don't let ENG-015 block ENG-014.** Make the SurrealDB *decision* early, but build ENG-014 on the
   Postgres+KB default behind its port; migrate later only if ENG-015 says "go" — no rework, thanks to
   the port abstraction.
4. **Ship auth (ENG-004) before enriching it (ENG-006).** Auth + a recorded principal is the P0;
   first-class persisted approval records are the P2 enhancement on top.
