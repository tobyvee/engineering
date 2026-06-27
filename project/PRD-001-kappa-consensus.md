# PRD-001 — Kappa-style consensus for implementation-direction decisions

- **Status:** Draft
- **Author role:** PM (with Lead Architect + Lead System Design input)
- **Lifecycle stage touched:** architecture + system design (shaping)
- **Date:** 2026-06-27
- **Related:** existing shaping stages (`epicShaping` / `SHAPING_STAGES`) · approval gates
  (`ApprovalKind.architecture_decision`) · ENG-008 (cyclic rework) · ENG-009 (structured outputs) ·
  ENG-014 (decision log)

## TL;DR

At the architecture / system-design stage, when a product feature has more than one viable
implementation direction, introduce a structured **consensus step**. The three senior technical role
agents — **Lead System Design, Lead Architect, Lead Engineer** — independently evaluate the candidate
directions; an **inter-rater agreement coefficient** (Cohen's/Fleiss' kappa family) quantifies how
much they actually agree, corrected for chance. If there is a clear winner *and* agreement clears a
configurable threshold, that direction is adopted. Otherwise a **tie-breaker** (default: escalate to
the human lead via the existing approval gate) resolves it. Every candidate, rating, rationale,
agreement score, and outcome is audited and recorded in the decision log (ENG-014), traceable to the
originating request.

## Interpretation note

"Kappa-style" is read here as **inter-rater reliability** — Cohen's kappa / Fleiss' kappa, the
statistics for agreement among multiple raters corrected for chance agreement. This is deliberately
*not* "Kappa architecture" (a streaming-data pattern) and *not* a distributed-consensus protocol
(Raft/Paxos). The fit is: several role agents are *raters*, and we want a principled measure of their
agreement plus a tie-breaker. If a different meaning was intended, flag it before build.

## Problem & motivation

- Shaping currently runs **sequentially** (PM → UX → Architect → System Design), each agent drafting
  one artifact handed downstream. There is no point at which the senior technical roles *converge on a
  direction* or surface and resolve disagreement.
- A single agent's chosen direction can be plausible-but-wrong, and there is no independent
  cross-check and no signal of how aligned/confident the unit actually is.
- When roles would disagree, nothing makes that disagreement visible or resolves it explicitly.

## Goals

- Make implementation-direction decisions the product of **independent** senior assessments, not one
  agent's pick.
- Produce a **quantified agreement signal** and require an explicit resolution path when agreement is
  low.
- Provide a **configurable tie-breaker**, defaulting to human-in-the-loop.
- Leave an **auditable, traceable** record that feeds the decision log (ENG-014).

## Non-goals

- Not a distributed-systems consensus protocol.
- Not applied to every ticket — scoped to arch/system-design-stage *direction* decisions where
  multiple viable options genuinely exist.
- Not a removal of human authority — the approval gate remains the backstop.

## Users & stakeholders

- **Human lead** — accountable; ultimate tie-breaker; reviews outcomes.
- **Lead System Design, Lead Architect, Lead Engineer** agents — the raters.
- **Optional tie-breaker persona** — a neutral fourth agent (config-only to add; invariant #6).
- **Staff Eng / QA** — downstream consumers of the chosen direction.

## Background — agreement coefficients (and how to use them honestly)

| Coefficient | Raters | Input | Fit here |
|-------------|--------|-------|----------|
| Cohen's kappa | 2 | categorical | n/a (we have 3 raters) |
| **Fleiss' kappa** | ≥3 | categorical | each rater **picks one** direction |
| **Kendall's W** (concordance) | ≥3 | rankings | each rater **ranks** the directions — richest signal |
| Krippendorff's alpha | any | any level | general-purpose fallback (ordinal scores, missing data) |

All correct for chance agreement, so they distinguish *genuine* agreement from coincidence.
Interpretation follows the Landis–Koch bands (≤0 poor … 0.61–0.80 substantial … 0.81–1 almost
perfect).

**Fleiss', not Cohen's — and why.** Cohen's kappa is defined for exactly **two** raters, so with our
three fixed raters it is ruled out for the panel as a whole. Fleiss' generalises to ≥3 raters but
technically assumes *interchangeable* raters; because our three are the **same identified roles** every
round, the more principled *nominal* measure is **Light's kappa** (the mean of the three pairwise
Cohen's kappas — so Cohen's survives as the pairwise building block). Fleiss' ≈ Light's in practice and
is far more widely implemented, so Fleiss' is an acceptable pragmatic stand-in for single-pick mode.
For the **recommended ranked** mode use **Kendall's W**; for ordinal per-criterion scores,
**Krippendorff's alpha**. **Implementation recommendation:** standardise on **Krippendorff's alpha** as
the single primary coefficient — it spans nominal / ordinal / ranked input, ≥3 fixed raters, and
missing ratings, so the coefficient need not change between Phase 1 (single-pick) and Phase 2 (ranked).
Decision tree: *2 raters → Cohen's · 3+ categorical → Fleiss' (Light's for fixed raters) · 3+ ranked →
Kendall's W · one coefficient for all → Krippendorff's alpha.*

> **Honest caveat that shapes the design:** with only **3 raters** and a handful of candidates, any
> chance-corrected coefficient is statistically **noisy** — a single flipped vote swings it a lot.
> Therefore the coefficient is used as a **confidence signal feeding a decision rule**, *not* as a
> hard statistical inference. The primary decision is the aggregate winner (Borda/mean); the
> coefficient gates whether that winner is trusted or sent to the tie-breaker.

## Proposed solution

### Flow

1. **Candidate generation** — produce 2–4 candidate implementation directions for the feature (each:
   summary, key tradeoffs, rough cost/risk). Source: the System Design agent enumerates options, or a
   fan-out where each of the three roles proposes one and duplicates are merged.
2. **Independent rating** — each of the three raters, *independently and without seeing the others'
   input*, scores or ranks the candidates against a shared rubric. Independence is what makes the
   agreement measure meaningful (this mirrors the judge-panel / independent-perspectives pattern).
3. **Aggregate + measure agreement** — aggregate into a ranked outcome (Borda count for rankings, or
   mean score) and compute the agreement coefficient (Kendall's W for rankings; Fleiss' kappa for
   single-picks).
4. **Decision rule** — *consensus* = (a clear top candidate) **AND** (agreement ≥ configurable
   threshold, default ≈ 0.6 "substantial"). If met → adopt that direction.
5. **Tie-breaker** — if there is no clear winner **OR** agreement < threshold → invoke the configured
   tie-breaker (below).
6. **Record + gate** — persist the chosen direction, all ratings + rationale, the agreement score, and
   any tie-break to the audit log + decision log (ENG-014). Optionally require human sign-off via the
   existing `architecture_decision` approval gate.

### Rating criteria

A shared, explicit rubric (configurable per unit), each criterion on a fixed **ordinal scale** so
ratings are comparable. Starting set: *simplicity · scalability · delivery risk · ADR alignment ·
cost-to-build · reversibility · testability*. The rubric is part of config, not code.

### Tie-breaker (the explicit requirement)

Configurable, with a recommended default:

- **(Default) Human escalation** via the existing approval gate (`ApprovalKind.architecture_decision`)
  — safest, aligns with invariant #4. The human sees every rating and the disagreement, then decides.
- **Casting-vote role** — a domain-weighted deciding vote: Lead Architect casts on
  architecture-dominant questions; Lead System Design on interface/data-design-dominant ones. For
  higher autonomy.
- **Dedicated tie-breaker agent** — a neutral fourth persona with a *distinct* rubric/lens (e.g.
  risk-first / devil's-advocate) producing a casting assessment. Adding it is a config change
  (invariant #6).

**Recommendation:** default to human escalation; allow opt-in to an agent casting vote or tie-breaker
persona for unattended runs, configured per unit.

### Workflow integration

- A new durable step at the architecture/system-design point of shaping — either a sub-stage of
  `epicShaping` or a dedicated `directionConsensus(epicId, featureId)` Temporal workflow.
- Reuses the multi-agent fan-out: independent rater activities run in **parallel** (barrier to collect
  all), then compute agreement, branch on the threshold, and (on tie-break) Signal the human gate.
- Budgets enforced per rater run (invariant #3); all events audited (invariant #2); outcome feeds the
  decision log (ENG-014) and is goal-traceable (invariant #1). Raters emit **structured** ratings via
  schema (ENG-009) so scores are parseable, not prose.

### Data model (sketch)

- **ConsensusRound** — `id`, `epicId`/`featureId`, `candidates[]`, `criteria[]`, `raterRoleIds[]`,
  `status`.
- **Rating** — `roundId`, `raterRole`, per-candidate scores/rank, `rationale`, `costCents`.
- **Outcome** — `roundId`, `chosenCandidate`, `aggregateMethod`, `agreementCoefficient` (+ which
  metric), `consensusReached` (bool), `tieBreaker` `{type, decidedBy}`, `decisionId` (→ ENG-014).

## Success metrics / acceptance criteria

- [ ] Direction decisions at the arch/system-design stage produce ≥2 candidates and 3 independent
      ratings.
- [ ] An agreement coefficient is computed and recorded per round, against a configurable threshold.
- [ ] When consensus is not reached, the configured tie-breaker resolves it (default: human gate) and
      the resolution is recorded with the deciding identity.
- [ ] Every round (candidates, ratings, rationale, score, outcome, tie-break) is audited and linked
      into the decision log (ENG-014), traceable to the originating request.
- [ ] Raters operate independently — no rater sees another's input before submitting.
- [ ] Budgets enforced; audited no-op/skipped path when the agent runtime is unavailable.
- **Health metrics to watch:** tie-break rate (too high → criteria unclear or candidates too similar;
  too low → raters may be correlated), and human-override rate at the gate.

## Rollout / phasing

1. **Phase 1** — categorical single-pick + Fleiss' kappa; human-escalation tie-breaker only; behind a
   flag and **advisory** (record the round and score but don't block).
2. **Phase 2** — ranked input + Kendall's W + Borda aggregation; promote to a real gate.
3. **Phase 3** — optional agent casting-vote / tie-breaker persona for unattended runs.

## Risks & mitigations

- **Statistical noise (3 raters):** the coefficient is a confidence signal feeding the decision rule,
  not a hard inference; the Borda/majority winner is primary.
- **Correlated raters (all Claude):** independence is procedural (no shared draft), but the models may
  still correlate and inflate agreement; mitigate with *distinct rubrics/lenses* per rater, genuinely
  distinct candidates, and (optionally) a devil's-advocate rater. Watch for suspiciously high
  agreement.
- **Ambiguous criteria → unstable ratings:** require an explicit fixed rubric and ordinal scale;
  iterate the criteria over time.
- **Cost / latency:** N rater runs per decision — bound candidates to 2–4, gate to genuinely
  multi-option decisions, and rely on per-role budgets for the ceiling.
- **Over-triggering:** only invoke when ≥2 viable candidates exist; otherwise shaping proceeds
  normally.

## Open questions

- Default input mode: single-pick (Fleiss) vs ranked (Kendall's W)? (Recommend ranked.)
- Default consensus threshold value, and per-unit configurability.
- Does the consensus outcome *always* pass through the human `architecture_decision` gate, or only on
  tie-break?
- If a tie-breaker agent is used, does it need a different model / effort tier than the raters?

## Next step

Implementation is tracked in **[ENG-016](ENG-016-implement-kappa-consensus.md)**, depending on ENG-009
(structured rater outputs) and feeding ENG-014 (decision log).
