# ENG-009 — Use structured outputs for agent response parsing

- **Status:** done
- **Priority:** P1 (High)
- **Stage:** implementation
- **Assignee role:** staff_engineer
- **Area:** packages/agents

> **Outcome (Wave 1):** `WorkerInput` gained an optional `outputSchema`; the **API backend** now emits
> `output_config: { format: { type: "json_schema", schema } }` (SDK 0.105) so responses are
> schema-constrained JSON. Hand-written JSON Schemas (`schemas.ts`: `PROPOSAL_SCHEMA` / `TICKETS_SCHEMA`
> / `VERDICT_SCHEMA`, within the API's structured-output constraints) are passed by
> `proposeFileChanges` / `proposeTickets` / `assess`. The **CLI backend** ignores the schema and keeps
> the prose-parse fallback. `ProposedChanges.parsed` distinguishes a parse failure from an empty change
> set, and `implementTicket` now audits "agent output could not be parsed" vs "no file changes
> proposed". Typecheck green; schema unit tests added; 35 agents+server tests pass.

## Problem

The agent helpers (`proposeFileChanges`, `proposeTickets`, `assess`) rely on prompting the model to
"Respond with ONLY a JSON object" and then best-effort `extractJson` parsing. A chatty or
slightly-off response silently degrades: `parseProposal` falls back to `files: []`, which the
workflow reads as "no file changes proposed" and skips delivery entirely — a silent failure on the
most important path.

## Evidence

- `packages/agents/src/propose.ts` — `CONTRACT` string + `extractJson` / `parseProposal` best-effort
  regex/brace extraction; empty/garbled output → `files: []`.
- `apps/server/src/temporal/activities.ts` — `implementTicket` treats `proposed.files.length === 0`
  as `delivery_skipped` ("no file changes proposed").
- `packages/agents/src/backends/api.ts` — the API backend sends no `output_config`.

## Proposed approach

- For the **API backend**, use structured outputs (`output_config: { format: { type: "json_schema",
  schema } }`) with a zod-derived JSON schema for each shape (proposal, tickets, QA verdict). On Opus
  4.8 this guarantees a parseable, schema-conformant response and removes the regex extraction.
- Keep the prose fallback only for the CLI backend (which can't easily use structured outputs);
  consider a stricter contract / retry there.
- Distinguish "genuinely no change needed" from "parse failure" so the latter is audited as an error,
  not silently skipped.

## Acceptance criteria

- [ ] API-backend agent calls return schema-validated JSON via structured outputs (no regex parsing).
- [ ] Parse failures are audited distinctly from a legitimate empty change set.
- [ ] Existing `parseProposal` / `parseTickets` tests pass or are updated for the new path.
- [ ] CLI-backend fallback path retains a tested contract.

## Notes / risks

- Structured outputs are incompatible with a few features (e.g. citations) — not a concern here.
- Directly improves whether autonomous runs actually produce committed code (relates to ENG-001).
