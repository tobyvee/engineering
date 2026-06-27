# ENG-008 — Implement cyclic review/blocked rework routing

- **Status:** backlog
- **Priority:** P2 (Medium)
- **Stage:** architecture
- **Assignee role:** lead_system_design (with lead_architect input)
- **Area:** apps/server

## Problem

The architecture states the lifecycle is "a durable state machine, not a batch DAG … review can
bounce work back and blockers loop," but the implementation does not loop. When QA fails or a
merge/deploy fails, `ticketLifecycle` simply sets the ticket to `blocked` and returns. There is no
feedback path back to the Staff Engineer to address the QA findings and re-attempt — so the promised
cyclic routing is not yet real.

## Evidence

- `apps/server/src/temporal/workflows.ts` —
  - QA fail: `if (!qaOk) { transitionTicket(ticketId, "blocked"); return }`
  - merge fail: `if (!merged) { ...blocked; return }`
  - deploy fail: `if (state === "failure") { ...blocked; return }`
- `packages/agents/src/assess.ts` produces a verdict + summary that is currently terminal, never fed
  back into a re-implementation step.

## Proposed approach

- Add a bounded rework loop: on QA fail, route the QA summary back to `proposeFileChanges` as feedback,
  re-open a revision, and re-run QA — up to a max attempt count, then `blocked` for human attention.
- Decide the same for recoverable merge/CI failures (e.g. failing checks → fix → re-push).
- Keep every transition audited and the loop bounded (no infinite cycles; respect budgets, ENG-007).

## Acceptance criteria

- [ ] A QA fail produces actionable feedback that drives a re-implementation attempt.
- [ ] The rework loop is bounded (configurable max attempts) and falls back to `blocked`.
- [ ] CI-failure rework path defined (even if minimal for v1).
- [ ] Workflow tests (ENG-002) cover the rework loop and the eventual `blocked` fallback.

## Notes / risks

- Bounding is essential — combine with budget enforcement so a stuck ticket can't burn a role's budget.
