# ENG-001 — Give coding agents real repository context

- **Status:** done
- **Priority:** P0 (Critical — blocks a usable autonomous run)
- **Stage:** implementation
- **Assignee role:** staff_engineer (with lead_system_design input)
- **Area:** packages/agents

> **Outcome (Wave 2):** `WorkerInput.workdir` added; the **CLI backend** runs `claude -p` with its cwd
> set to the provided workdir (the cloned target repo from ENG-013) so the agent reads and edits real
> source — and a provided workdir is *persistent* (not cleaned up like the throwaway sandbox).
> `proposeFileChanges` forwards `workdir`; `implementTicket` clones the repo (ENG-013) and passes the
> path so the Staff Engineer codes against real files, auditing `repo_context_ready` /
> `repo_context_skipped`. The product's own tree is never touched (the agent works under the separate
> working-code workspace). Test: the agent reads a seeded file in the workdir and the workdir is left
> intact.
>
> *Deferred (noted):* the **API backend** is tool-less, so file-context injection for it (a directory
> tree / key files in the prompt) is a follow-up — the CLI backend is the real repo-aware path.

## Problem

Neither `Worker` backend can see the repository it is supposed to modify, so the coding agent writes
blind, hallucinated diffs that are then committed via the Git Data API. This is the single biggest
gap between the current "demo" state and the documented "one `ANTHROPIC_API_KEY` away from a live
autonomous run" claim.

- The **API backend** is a single tool-less `messages.create` — the Staff Engineer agent imagines
  file contents from the prompt and never reads real source.
- The **CLI backend** is full Claude Code but is deliberately confined to an empty throwaway dir
  under `workspaces/`, so it also cannot read the target codebase.

## Evidence

- `packages/agents/src/backends/api.ts` — `ApiBackend.run` sends `messages.create` with no `tools`.
- `packages/agents/src/backends/cli.ts` — `createSandbox` / `resolveWorkspaceRoot` create an empty
  per-run dir; the agent's cwd has no repo in it.
- `apps/server/src/temporal/activities.ts` — `implementTicket` feeds only `traceContext` (the
  mission→goal→epic→ticket "why"), never repository files, to `proposeFileChanges`.

## Proposed approach

Build on the **working-code workspace** provisioned by ENG-013 (the persistent shared root holding the
cloned target repo — distinct from the throwaway agent-state sandbox). Then thread repo context into
`implementTicket`:

1. **CLI backend, repo-aware:** run `claude -p` with its cwd in the cloned target repo inside the
   working-code workspace, so the agent reads and edits against real source. Preserve the "never
   mutate this product's own source" guarantee by operating on the cloned target repo (a per-ticket
   branch/worktree), never this repo's working tree.
2. **API backend, context injection:** retrieve relevant files from the clone (by path heuristics /
   the ticket description) and include them in the prompt, or give the API backend a read-only file
   surface over the working-code workspace.

Surface a knob (e.g. `AGENT_REPO_CONTEXT`) and keep the no-op/skipped audit path for when no repo is
configured.

## Acceptance criteria

- [ ] A coding agent run can read existing files from the target repository before proposing changes.
- [ ] Proposed `FileChange`s are diffs against actual file content, not invented whole-file rewrites
      of files the agent never saw.
- [ ] The repo this product lives in is never mutated by an agent (clone/copy isolation preserved).
- [ ] Behaviour is config-gated and audited (`*_skipped` when no repo is available).
- [ ] A test demonstrates the agent reading a seeded file and editing it.

## Notes / risks

- **Depends on ENG-013** (repo provisioning + the two-root workspace model) to produce the clone the
  agents work against.
- Interacts with ENG-005 (sandbox env scrubbing) and ENG-009 (structured outputs).
- Decide whether the clone is per-ticket (fresh) or cached per-repo for speed.
