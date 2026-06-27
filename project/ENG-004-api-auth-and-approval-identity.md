# ENG-004 — API authentication + approval identity

- **Status:** backlog
- **Priority:** P0 (Critical — do before any live/shared deployment)
- **Stage:** architecture
- **Assignee role:** lead_system_design (with lead_architect sign-off)
- **Area:** apps/server

## Problem

The HTTP API has no authentication or authorization. Anyone who can reach the server can approve
merges and deploys, release the roadmap gate, start workflows, and create tickets. The approval gates
are the product's core value (invariant #4: "the human is in the loop"), yet there is no identity
behind the human — approval events are audited as the literal actor `"human"` with no `decidedBy`.
This undermines both invariant #4 and invariant #2 (audit-log integrity: who actually decided?).

## Evidence

- `apps/server/src/app.ts` — `new Hono()` with no auth middleware; `POST /api/tickets/:id/approve`
  and `POST /api/epics/:id/approve-roadmap` are unauthenticated.
- `apps/server/src/temporal/activities.ts` — `recordRoadmapApproval` appends
  `{ actor: "human" }` with no identity; merge/deploy approvals similarly anonymous.
- `packages/core/src/schema.ts` — `Approval.decidedBy` exists in the schema but is never populated.

## Proposed approach

- Add auth middleware to the Hono app (token / session / OIDC — choose per deployment model).
- Require an authenticated principal on all mutating routes, especially the approval gates.
- Thread the principal's identity into approval audit events (`decidedBy`), so the audit log records
  *who* released each gate.
- Keep read views (Board/Roadmap/Audit) and write routes appropriately scoped.

## Acceptance criteria

- [ ] All mutating endpoints reject unauthenticated requests.
- [ ] Approval endpoints record the authenticated identity in the audit event (`decidedBy` populated).
- [ ] The dashboard authenticates and attaches the principal to approval actions.
- [ ] Tests cover: unauthenticated approval rejected; authenticated approval records identity.

## Notes / risks

- Pairs with ENG-006 (first-class approvals) — identity should live on the persisted approval record.
- Decide whether identity is per-user accounts or a single shared operator token for v1.
