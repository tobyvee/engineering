# ENG-002 — Test the Temporal orchestration layer

- **Status:** done
- **Priority:** P1 (High)
- **Stage:** review
- **Assignee role:** qa_test
- **Area:** apps/server

> **Outcome (Wave 0):** `apps/server/src/temporal/workflows.test.ts` drives the workflows through
> `@temporalio/testing` time-skipping with mocked activities (no live services). 8 tests cover:
> happy-path → `done` (both gates), merge-gate-blocks-until-approved, QA-fail → `blocked`, merge-fail
> → `blocked`, deploy-fail → `blocked`, the roadmap gate (blocks until `roadmapApprove`, then
> decomposes), all shaping stages run, and heartbeat picks up the backlog. The bundle compiles once
> in `beforeAll`. Runs inside `pnpm test` (59 tests total); typecheck + lint green. Added
> `@temporalio/testing` to `apps/server` devDependencies.

## Problem

The most complex, most stateful code in the system — the durable workflows and their activities — has
zero automated tests. All 51 existing tests live in `core` / `agents` / `integrations`; `apps/server/src`
has no `.test.ts` files at all. The approval gates, block-on-failure paths, and CI/deploy polling loops
are exactly the logic most likely to regress and hardest to verify by hand.

## Evidence

- `apps/server/src/temporal/workflows.ts` — `ticketLifecycle`, `epicShaping`, `epicDecomposition`:
  no tests.
- `apps/server/src/temporal/activities.ts` — `implementTicket`, `verifyTicket`, deploy/merge
  activities: no tests.
- `find apps/server/src -name '*.test.ts'` → none.

## Proposed approach

Use Temporal's official test harness (`@temporalio/testing` → `TestWorkflowEnvironment`) with mocked
activities to drive the workflows deterministically:

- Assert `ticketLifecycle` reaches `done` only after both the merge and deploy signals.
- Assert a QA fail (`verifyTicket → false`) routes to `blocked` and stops.
- Assert a failed merge / failed deploy routes to `blocked` (no longer reaches `done`).
- Assert `epicDecomposition` blocks until the `roadmapApprove` signal, then decomposes.
- Use time-skipping to cover the CI/deploy poll loops without real waits.

## Acceptance criteria

- [ ] `@temporalio/testing` wired into the Vitest setup for `apps/server`.
- [ ] Tests cover: both gates, QA-fail block, merge-fail block, deploy-fail block, roadmap gate.
- [ ] Tests run in `pnpm test` and in CI (see ENG-003).
- [ ] Poll loops are exercised via time-skipping, not wall-clock sleeps.

## Notes / risks

- Pairs naturally with ENG-003 (CI) so these tests actually gate merges.
