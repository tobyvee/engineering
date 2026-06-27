# ENG-011 — Decide the initial issue tracker

- **Status:** done (decision recorded below)
- **Priority:** P3 (Low)
- **Stage:** discovery
- **Assignee role:** lead_architect (with PM input)
- **Area:** packages/core · packages/integrations

## Decision (Wave 0 spike outcome)

**v1 default: GitHub Issues/Projects** (with the **Postgres** backend for standalone/local runs).
Linear/Jira are **deferred** — addable later behind the unchanged `IssueTracker` port if a concrete
need arises.

**Why GitHub:**
- **Already built** — `GitHubIssueTracker` exists, plus the Mission→Goal→Epic hierarchy as native
  GitHub **sub-issues** and a repo-docs KB. It's the lowest-effort path; no new integration to write.
- **Where the work already lives** — the operator is an engineering unit already on GitHub for code,
  PRs, CI, and the Actions deploy. Keeping issues there gives native ticket ↔ PR ↔ commit linkage and
  one fewer external system.
- **No lock-in** — selection is governed by `PERSISTENCE_BACKEND` behind the `IssueTracker` port, so
  swapping to Linear/Jira later never touches `core` (invariant #5).

**Interface sufficiency:** confirmed for GitHub — the port already round-trips ticket fields (via a
metadata block) and models the goal hierarchy through sub-issues. For Linear/Jira the port would need
re-validation (hierarchy/acceptance-criteria mapping) **at the time an adapter is built**, not now.

**Follow-up:** none required for v1. If/when an external tracker is requested, open an adapter ticket
that (1) re-checks the `IssueTracker` interface against that tracker and (2) implements it behind the
factory. CLAUDE.md's "Still open" note can be updated to reflect this decision (a one-line lead edit).

## Problem

The initial issue-tracker choice is the one remaining "still open" decision in CLAUDE.md: GitHub
Issues/Projects vs. an external tracker (Linear/Jira) behind the same `IssueTracker` interface.
Postgres and GitHub backends exist; no external-tracker adapter does. This is a decision-and-maybe-a-
spike rather than a defect.

## Evidence

- `CLAUDE.md` → Decisions → "Still open: Initial issue tracker: GitHub Issues/Projects vs. external
  (Linear/Jira) behind the same interface."
- `packages/core/src/tracker.ts` — `IssueTracker` port; `packages/db` + `packages/integrations/github`
  implement it; no Linear/Jira implementation.

## Proposed approach

- Capture the decision criteria (who the operator is, where their work already lives, API ergonomics,
  sub-issue/hierarchy support, cost).
- Confirm the `IssueTracker` interface is sufficient for an external tracker (hierarchy, acceptance
  criteria round-trip), and note any gaps.
- Decide v1 default; if external, scope a thin adapter spike behind the existing interface.

## Acceptance criteria

- [ ] A written decision (with rejected alternatives) recorded in CLAUDE.md / OVERVIEW.
- [ ] Confirmation that `IssueTracker` covers the chosen tracker's needs, or a list of interface gaps.
- [ ] If external is chosen: a scoped follow-up ticket for the adapter.

## Notes / risks

- Swapping backends must not touch `core` (invariant #5) — validate the interface holds.
