# ENG-016 — Implement Kappa-style consensus (PRD-001)

- **Status:** backlog
- **Priority:** P2 (Medium — feature; not a live-run blocker)
- **Stage:** implementation
- **Assignee role:** staff_engineer (schema + agreement function design with lead_system_design;
  gate/flow with lead_architect)
- **Area:** packages/core (schema + agreement fn) · packages/agents (rater + candidate gen) ·
  apps/server (workflow + activities + tie-break gate) · apps/web (optional view, later phase)

## Summary

Build the consensus mechanism specified in [PRD-001](PRD-001-kappa-consensus.md): at the
architecture/system-design stage, three role agents (**Lead System Design, Lead Architect, Lead
Engineer**) independently rate candidate implementation directions; an inter-rater agreement
coefficient gates whether a clear winner is adopted or sent to a **tie-breaker** (default: human
escalation via the existing approval gate). All rounds are budget-enforced, audited, and recorded in
the decision log.

## Dependencies

- **ENG-009 (structured outputs)** — *hard*: raters must emit schema-conformant ratings, not prose.
- **ENG-014 (decision log)** — *soft*: outcomes feed the decision graph; audit-log in the interim if
  ENG-014 isn't built yet.
- **ENG-002 (workflow test harness)** — for testing the consensus / tie-break branches.
- Existing: shaping stages (`SHAPING_STAGES` / `epicShaping`), approval-gate signal pattern, `ROLES`,
  central budgets, audit log.

## Build breakdown

1. **Schema & config (core).** `ConsensusRound`, `Rating`, `Outcome` zod schemas in
   `packages/core/src/schema.ts`; a `ConsensusConfig` (criteria rubric · `inputMode: "pick" | "rank"`
   · threshold · tie-breaker policy). Shared with server/web via the existing core export.
2. **Agreement coefficients (core, pure).** An `agreement(ratings, mode)` module returning
   `{ coefficient, metric }`. Implement **Krippendorff's alpha** as the primary (spans nominal /
   ordinal / ranked, ≥3 fixed raters, missing data); support **Fleiss' / Light's kappa** (nominal
   single-pick) and **Kendall's W** (ranked) per the PRD decision tree. Pure and heavily unit-tested.
3. **Aggregation/decision (core, pure).** `decide(ratings, config)` → `{ winner, consensusReached }`
   via Borda count (ranked) or mean score, gated on `coefficient ≥ threshold`.
4. **Rater + candidate agents (agents).** A `rateDirections({ role, candidates, criteria, … })` helper
   (sibling to `assess` / `draft` / `proposeTickets`) emitting a structured `Rating` via structured
   outputs (ENG-009). Candidate generation (`proposeDirections`, or reuse the System Design draft) to
   enumerate 2–4 genuinely distinct directions.
5. **Consensus workflow (server).** A durable step — a sub-stage of `epicShaping` or a dedicated
   `directionConsensus(epicId, featureId)` workflow + activities: generate candidates → run the three
   rater activities **independently in parallel (barrier)** → compute agreement + decide → branch.
   Budget-enforced per rater (invariant #3); every step audited (invariant #2).
6. **Tie-breaker (server).** Default: human escalation — a new gate reusing
   `ApprovalKind.architecture_decision`, with a workflow Signal + client fn + API endpoint mirroring
   `approveRoadmap` / `approveTicket` in `temporal/client.ts` + `app.ts`. Optional (later): a
   domain-weighted casting-vote role or a dedicated tie-breaker persona (roles-as-config, invariant #6).
7. **Persistence / provenance.** Persist round/ratings/outcome; append audit events; emit a decision
   node to ENG-014 (or audit-only interim), traceable to the originating request (invariant #1).
8. **Config & roles.** Criteria rubric, input mode, threshold, and tie-breaker policy as per-unit
   config (not hardcoded — invariant #6).
9. **Tests.** Agreement-fn unit tests with fixtures for perfect / zero / negative / **degenerate**
   agreement (see risks); rater-output parsing; workflow-branch tests (consensus-reached vs
   tie-break→gate) via the ENG-002 harness.

## Phasing (mirrors the PRD rollout)

- **Phase 1** — single-pick + Fleiss'/Krippendorff; human-escalation tie-breaker; behind a flag and
  **advisory** (record the round + score, don't block).
- **Phase 2** — ranked input + Kendall's W / Krippendorff's alpha + Borda; promote to a real gate.
- **Phase 3** — optional agent casting-vote / tie-breaker persona; optional dashboard view (fold into
  ENG-010).

## Acceptance criteria

- [ ] `core` schemas + `ConsensusConfig` for round/rating/outcome, shared via zod.
- [ ] A pure, unit-tested agreement function — Krippendorff's alpha primary, with Fleiss'/Light's and
      Kendall's W — covering perfect / none / partial / degenerate agreement.
- [ ] A pure aggregation/decision function (winner + `consensusReached` vs threshold).
- [ ] A rater agent helper emits **structured** ratings (ENG-009) for each of the three roles,
      **independently** (no rater sees another's input); candidate generation yields 2–4 distinct
      directions.
- [ ] A durable consensus step runs the parallel raters, computes agreement, and branches on the
      threshold; budget-enforced and audited.
- [ ] Tie-break default = human escalation via the `architecture_decision` gate (Signal + endpoint,
      mirroring `approveRoadmap`); resolution recorded with the deciding identity.
- [ ] Round / ratings / outcome persisted and linked into the decision log (ENG-014) — or audit-logged
      if ENG-014 isn't yet available — traceable to the originating request.
- [ ] Config-driven (criteria · input mode · threshold · tie-breaker policy) per unit; no-op/skipped
      path when the agent runtime is unavailable.
- [ ] Workflow tests cover both the consensus-reached and tie-break→gate paths.

## Risks / implementation notes

- **Degenerate coefficient cases:** when all raters rate identically (or every candidate scores the
  same), the chance-agreement term can make kappa **undefined** (0/0). Handle explicitly — unanimous
  agreement must map to "consensus", not `NaN`.
- **Correlated raters (all Claude):** independence is procedural; reinforce with distinct rubrics/lenses
  per rater and genuinely distinct candidates, and watch for suspiciously high agreement (PRD risk).
- **Cost/latency:** N rater runs per decision — bound candidates to 2–4 and only trigger when ≥2
  viable options exist; per-role budgets cap spend.
- **Cross-store atomicity:** if ENG-015 (SurrealDB) lands, the round/decision writes and the
  Temporal/Postgres state are not transactional together — make writes idempotent and audit-anchored.

## Out of scope

- The dashboard consensus-round view beyond a minimal read (Phase 3 / ENG-010).
- Non-`architecture_decision` tie-breaker policies beyond the configurable default.
