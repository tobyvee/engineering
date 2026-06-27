# ENG-006 — Make approval gates first-class, persisted entities

- **Status:** done
- **Priority:** P2 (Medium)
- **Stage:** design
- **Assignee role:** lead_system_design
- **Area:** packages/core · apps/server

> **Outcome (Wave 3):** Approvals are now first-class persisted records (the `approvals` table already
> existed; added an `epic_id` column — core schema + migration `0004` — so roadmap/epic gates fit too).
> Repo: `createApproval` / `resolveApproval` / `listPendingApprovals`. Each gate creates a pending
> record (`requestRoadmapSignoff` + a new `requestApproval` activity called before the merge and deploy
> conditions); the approve endpoints resolve it with `decidedBy` (the authenticated principal from
> ENG-004). `/api/approvals` now reads the table across **all** gate kinds (roadmap · pr_merge ·
> deploy), and the web Approvals page dispatches the right approve call per kind.

## Problem

Pending approvals are not modelled as real entities. The `/api/approvals` endpoint reconstructs
pending gates by replaying the audit log and **only surfaces roadmap gates** — the merge and deploy
gates exist solely as in-memory booleans inside the running Temporal workflow, so they cannot be
listed, queried, or shown in the UI, and "what's pending" does not survive cleanly as a queryable
view. Meanwhile the `Approval` / `ApprovalKind` zod schemas already designed in `core` are unused.

## Evidence

- `apps/server/src/app.ts` (`GET /api/approvals`) — derives pending state from audit events and only
  emits `kind: "roadmap"`.
- `apps/server/src/temporal/workflows.ts` — `ticketLifecycle` holds `approved = { merge, deploy }`
  as workflow-local state; nothing persists "a merge gate is pending."
- `packages/core/src/schema.ts` — `Approval` and `ApprovalKind` (`roadmap` · `design_signoff` ·
  `architecture_decision` · `pr_merge` · `deploy`) defined but unused.

## Proposed approach

- Persist a pending-approval record when any gate is reached (roadmap / merge / deploy), resolve it
  on signal, and record the deciding identity (see ENG-004).
- Back `/api/approvals` with the persisted records instead of audit replay, covering all gate kinds.
- Update the Approvals page to show every pending gate, not just roadmap.

## Acceptance criteria

- [ ] Reaching any gate creates a queryable pending `Approval` record using the existing schema.
- [ ] `/api/approvals` returns roadmap, merge, and deploy gates.
- [ ] Approving a gate resolves the record (status + `decidedBy` + `decidedAt`).
- [ ] The Approvals UI lists all pending gates across tickets and epics.

## Notes / risks

- Keep the audit log as the append-only source of truth; the approval record is a derived,
  mutable read-model — do not mutate audit history (invariant #2).
