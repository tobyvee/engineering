# Project tickets

Backlog of work items derived from a codebase review (2026-06-27). Each ticket is self-contained
and uses the project's own vocabulary — `status` / `stage` / `assignee role` / `acceptance criteria`
mirror the `TicketStatus`, `LifecycleStage`, and `RoleId` enums in `packages/core/src/schema.ts`.

**See [ROADMAP.md](ROADMAP.md) for the recommended implementation order** (dependency-sequenced waves
+ critical path).

| # | Title | Priority | Area |
|---|-------|----------|------|
| [ENG-001](ENG-001-repo-aware-coding-agents.md) | Give coding agents real repository context | P0 | packages/agents |
| [ENG-002](ENG-002-test-orchestration-layer.md) | Test the Temporal orchestration layer | P1 | apps/server |
| [ENG-003](ENG-003-ci-for-this-repo.md) | Add CI for this repository | P1 | repo / .github |
| [ENG-004](ENG-004-api-auth-and-approval-identity.md) | API authentication + approval identity | P0 | apps/server |
| [ENG-005](ENG-005-scrub-cli-sandbox-env.md) | Scrub the environment for CLI agent sandboxes | P1 | packages/agents |
| [ENG-006](ENG-006-first-class-approvals.md) | Make approval gates first-class, persisted entities | P2 | core / server |
| [ENG-007](ENG-007-budget-model-reset-and-reservation.md) | Fix the budget model (reset + reservation) | P2 | packages/db |
| [ENG-008](ENG-008-cyclic-rework-routing.md) | Implement cyclic review/blocked rework routing | P2 | apps/server |
| [ENG-009](ENG-009-structured-outputs-for-agents.md) | Use structured outputs for agent response parsing | P1 | packages/agents |
| [ENG-010](ENG-010-dashboard-budgets-and-cost.md) | Surface budgets and cost in the dashboard | P2 | apps/web |
| [ENG-011](ENG-011-decide-initial-issue-tracker.md) | Decide the initial issue tracker | P3 | core / integrations |
| [ENG-012](ENG-012-research-a2a-protocol.md) | Research Google's A2A (Agent-to-Agent) protocol | P2 | architecture |
| [ENG-013](ENG-013-repo-provisioning-and-shared-workspace.md) | Repository provisioning via the PM agent (git + gh) & two-root workspace | P0 | core · agents · server |
| [ENG-014](ENG-014-decision-log-and-provenance-tree.md) | Per-agent decision logs & a traceable decision tree | P2 | core · db · server |
| [ENG-015](ENG-015-evaluate-surrealdb-backend.md) | Evaluate SurrealDB as a persistence backend (decision spike) | P2 | core · db · infra |
| [ENG-016](ENG-016-implement-kappa-consensus.md) | Implement Kappa-style consensus (PRD-001) | P2 | core · agents · server |

**Priority key:** P0 = do before any live autonomous run · P1 = high · P2 = medium · P3 = low.

## Product requirements (PRDs)

| Doc | Summary |
|-----|---------|
| [PRD-001](PRD-001-kappa-consensus.md) | Kappa-style consensus for implementation-direction decisions (Lead System Design · Lead Architect · Lead Engineer + tie-breaker) |
