# ENG-007 — Fix the budget model (reset window + reservation)

- **Status:** done
- **Priority:** P2 (Medium)
- **Stage:** implementation
- **Assignee role:** staff_engineer (with lead_system_design input)
- **Area:** packages/db

> **Outcome (Wave 3):** **Monthly reset** — `period_start` column (migration `0003`) + lazy
> `rolloverIfExpired` inside `getBudgetRemaining`, so `monthlyBudgetCents` is a real monthly window
> (auto-applies to every activity). **Reservation** — atomic `reserveBudget` (conditional UPDATE that
> can't exceed the limit) + `reconcileSpend` (settle hold → actual); `estimateRunCostCents` sizes the
> worst-case hold; all four agent activities now reserve→run→reconcile (release on failure/skip on
> exhaustion), closing the read-then-spend TOCTOU. Pure helpers `periodExpired` / `canReserve` unit
> tested. (DB atomicity itself isn't unit-tested — no live DB in CI — consistent with the rest of
> `repo.ts`.)

## Problem

Budgets are softer than invariant #3 ("budgets are enforced by the orchestrator") implies:

1. **No reset window.** Despite the field name `monthlyBudgetCents`, `addSpend` only ever increments
   `spentCents`; there is no monthly (or any) reset, so spend accumulates forever until the role is
   silently exhausted.
2. **Read-then-spend TOCTOU.** Remaining budget is read *before* the agent runs with no reservation,
   so two concurrent runs for the same role both observe the full remaining budget and can jointly
   overspend. The per-call `affordableMaxTokens` cap mitigates a single run but is not a global ceiling.

## Evidence

- `packages/db/src/repo.ts` — `addSpend` does `spentCents + c` (atomic increment, good) but never
  resets; `getBudgetRemaining` reads `limit - spent` with no reservation.
- `packages/core/src/roles.ts` — `monthlyBudgetCents` implies a monthly window that doesn't exist.
- `apps/server/src/temporal/activities.ts` — each agent activity reads `getBudgetRemaining` then
  `addSpend` after the run, with no debit-on-start.

## Proposed approach

- Introduce an explicit budget period (e.g. a `periodStart` / rolling window) and reset/roll spend,
  or rename to honest lifetime semantics if no reset is intended.
- Add a reservation/debit pattern: reserve an estimated cost on start, reconcile to actual on
  completion — closing the TOCTOU gap for concurrent same-role runs.

## Acceptance criteria

- [ ] Budget semantics are explicit: either a real reset window or clearly-named lifetime budgets.
- [ ] Concurrent agent runs for one role cannot jointly exceed the role's remaining budget.
- [ ] Spend reconciliation (estimate → actual) is recorded and audited.
- [ ] Tests cover: exhaustion blocks further runs; concurrent runs respect the ceiling; reset (if any).

## Notes / risks

- Keep `addSpend`'s atomic SQL increment; the change is about *reservation* and *windowing*, not the
  write itself.
