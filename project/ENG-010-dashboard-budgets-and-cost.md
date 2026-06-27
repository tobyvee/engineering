# ENG-010 — Surface budgets and cost in the dashboard

- **Status:** done
- **Priority:** P2 (Medium)
- **Stage:** design
- **Assignee role:** ux_design (build by staff_engineer)
- **Area:** apps/web

> **Outcome (Wave 3):** `listBudgets` repo helper + typed `/api/budgets` endpoint (per-scope
> limit/spent/remaining). A new web **Budgets** page (TanStack Query, auto-refresh) shows each role's
> limit/spent/remaining in dollars plus a unit total, with a nav link + route. Verified via the web
> build. Pairs with ENG-007's now-meaningful monthly budgets.

## Problem

The dashboard is the accountable lead's primary surface, but it shows no budget or cost view even
though all the data already exists: per-role `limitCents` / `spentCents` in the budgets table, and
per-event `costCents` on audit records. The lead governs budgets (a stated core responsibility) with
no visibility into spend.

## Evidence

- `packages/db/src/repo.ts` — `getBudgetRemaining` / `addSpend` maintain per-scope limit/spent.
- `apps/server/src/temporal/activities.ts` — agent steps record `costCents` in audit payloads.
- `apps/web/src/pages/` — Board / Roadmap / Approvals / Audit exist; no budgets/cost page.

## Proposed approach

- Add a budgets/cost view: per-role limit · spent · remaining, plus a rollup of total spend.
- Optionally trend cost over time from the audit log's `costCents` events.
- Expose a read endpoint for budgets (the data is currently Postgres-direct; add `/api/budgets`).

## Acceptance criteria

- [ ] A dashboard view shows per-role limit / spent / remaining.
- [ ] A total-spend summary is visible to the lead.
- [ ] Data comes from a typed API endpoint, consistent with the existing `core`-shared schema pattern.
- [ ] Empty/zero states render cleanly before any spend has occurred.

## Notes / risks

- Depends partly on ENG-007 if budget semantics (reset window) change — align the labels.
