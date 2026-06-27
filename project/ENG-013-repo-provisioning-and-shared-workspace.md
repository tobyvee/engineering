# ENG-013 — Repository provisioning via the PM agent (git + gh) & shared workspace

- **Status:** done
- **Priority:** P0 (Critical — prerequisite for ENG-001)
- **Stage:** discovery → implementation
- **Assignee role:** pm (owns repo create / list / clone); supporting backend work (per-role tool
  gating, scoped auth) by staff_engineer with lead_system_design input
- **Area:** packages/core (role config) · packages/agents (CLI backend tool gating + auth) ·
  apps/server (shared workspace + audit)

> **Outcome (Wave 2):**
> - **Two-root workspace** — `packages/agents/src/workspace.ts` (`resolveCodeWorkspaceRoot` /
>   `repoWorkspacePath`): a *persistent* working-code root (`workspace/` singular, env
>   `AGENT_CODE_WORKSPACE`) for cloned target repos, distinct from the throwaway `workspaces/`
>   agent-state sandboxes. `/workspace/` gitignored.
> - **PM tool grant** — `ROLES.pm.tools` now includes `git` + `gh`, and the PM prompt covers
>   list/reuse/create/clone (idempotent).
> - **Scoped-token enforcement** — `sandboxEnv(source, role)` forwards `AGENT_PM_GITHUB_TOKEN` as
>   `GITHUB_TOKEN`/`GH_TOKEN` **only** to the PM sandbox; the host `GITHUB_TOKEN` is never forwarded to
>   any agent. This is the real security boundary (only the PM can authenticate git/gh).
> - **Idempotent provisioning** — `provision.ts` (`repoTargetFromEnv` / `provisionAction` / `gitArgs` /
>   `ensureRepoCloned`): shallow clone-or-ff-pull into the working-code workspace, token passed via
>   `http.extraheader` (never written to `.git/config`); no-op when GitHub unconfigured. Wired into
>   `implementTicket` with `repo_context_ready` / `repo_context_skipped` audit events.
> - Tests: workspace layout, provisioning (skip/action/args), PM-scoped token.
>
> *Deferred (noted):* (1) literal `claude --allowedTools` tool-name gating — the security boundary is
> enforced via the scoped token, so the abstract→Claude-Code tool-name mapping is a follow-up; (2)
> per-epic repo *association* — the target repo is the configured `GITHUB_OWNER`/`GITHUB_REPO` (same as
> delivery) for now; moving repo selection onto the Goal/Epic is a follow-up.

## Decision

Per the product owner's direction, the **PM agent owns repository provisioning** and is granted two
command-line tools:

- **`git`** — create local repos (`git init`) and perform local git operations.
- **`gh`** — list remote repos on the GitHub account, and create/clone remote repos.

The PM creates a repo if it does not already exist, lists existing repos, and clones the target into
the **shared `./workspace`** so the other agents can inspect and work on it. This supersedes the
earlier "port + activities" proposal; provisioning is driven by the PM agent via CLI, with the
safeguards below so it stays reliable and secure.

## Problem

For agents to work on a codebase it must exist locally first. Today there is no way to create a repo
when missing, discover existing repos, or clone a target into a workspace agents can read. ENG-001
("give agents real repository context") depends on this provisioning step existing.

## Evidence / context

- `packages/core/src/roles.ts` — `RolePersona.tools` is the per-role allow-list. PM is currently
  `tools: ["tracker", "docs"]`; this ticket adds `"git"` and `"gh"`. Roles are config (invariant #6),
  so this is a data change, not orchestrator branching.
- `packages/agents/src/backends/cli.ts` — the CLI backend runs full Claude Code (`claude -p`) with
  bash; today it does **not** pass a per-role tool allow-list, so the `tools` array is *advisory*
  only. The API backend has no tools at all.
- `packages/agents/src/backends/cli.ts` — `resolveWorkspaceRoot` / `createSandbox` create *throwaway,
  per-run* role sandboxes (`workspaces/<role>-xxxx`). The shared target-repo clone is a **separate**
  artifact.

## Proposed approach

1. **Grant the tools (config):** add `"git"` and `"gh"` to `ROLES.pm.tools`, and extend the PM system
   prompt to describe when to create / list / clone (create-if-missing; clone into the shared
   workspace; prefer reuse of an existing repo).
2. **Make the grant real (enforcement):** the CLI backend must enforce the per-role allow-list (e.g.
   `claude -p --allowedTools` / `--disallowedTools` derived from `role.tools`) so the PM gets
   `git`/`gh` and other roles do not. Without this, every CLI agent already has git/gh via bash and
   the grant is meaningless. *(If this turns out large, split it into its own ticket.)*
3. **Scoped auth:** `gh` needs a token and `git` needs credentials for private repos. Provide the PM
   sandbox a **least-privilege** `GITHUB_TOKEN` / `GH_TOKEN` (repo create + read/list scope) — the
   controlled exception to ENG-005's env-scrubbing, never the full host token.
4. **Two separate sandboxed roots (explicit):**
   - **Agent-state sandbox** — the existing per-run, throwaway role scratch dir
     (`workspaces/<role>-xxxx`, via `AGENT_WORKSPACE_DIR`); ephemeral, cleaned up after each run, where
     the agent reasons and scratches. **No product code lives here.**
   - **Working-code workspace** — a new, *persistent* shared root holding cloned target repos that
     agents inspect and modify (e.g. `./workspace` or `workspaces/repos/<owner>/<repo>`, behind a new
     env var such as `AGENT_CODE_WORKSPACE`). Use per-ticket branches/worktrees for concurrency.

   Naming gotcha: the existing throwaway root is plural `workspaces/`; pick a clearly distinct name
   for the code workspace so the two roots aren't conflated.
5. **Idempotency + verification:** create-if-missing must be safe to repeat. Because this runs as an
   LLM + CLI step (less deterministic than a plain activity), the workflow/activity should **verify**
   the repo/clone actually exists and **audit** the provisioning actions, so a flaky agent turn can't
   silently leave no repo.
6. **Repo selection stays a planning decision:** *which* repo (new vs. existing) is associated with
   the Goal/Epic at roadmap authoring; the PM proposes it and the human approves at the existing
   roadmap gate.

## Acceptance criteria

- [ ] `ROLES.pm.tools` includes `git` and `gh`; the PM prompt explains create/list/clone duties.
- [ ] The CLI backend enforces the per-role tool allow-list so non-PM roles do **not** receive
      `git`/`gh` (the grant is real, not advisory).
- [ ] The PM agent can: create a repo when missing, list remote repos (`gh`), and clone a repo into
      the shared workspace.
- [ ] Two distinct roots exist and are documented — an **ephemeral agent-state sandbox** and a
      **persistent working-code workspace**; product code only ever lives in the latter, with a
      defined concurrency model.
- [ ] `gh`/`git` auth uses a scoped, least-privilege token provided only to the PM sandbox (documented
      ENG-005 exception).
- [ ] Provisioning is idempotent and audited; the workflow verifies the repo/clone exists before
      downstream stages depend on it.
- [ ] No-op / `*_skipped` audit when GitHub or the token is unconfigured.

## Notes / risks

- **Unblocks ENG-001** — coding agents read/write against the clone this ticket produces.
- **Reliability:** an LLM-driven CLI step is less deterministic than a plain activity — mitigate with
  idempotent commands (`git init` / `gh repo create` guarded by existence checks), post-step
  verification, and audit.
- **Security:** scoped token only (see ENG-005); never expose the full host token to agent bash.
- **Concurrency:** multiple agents in one working tree will corrupt git state — prefer per-ticket
  worktrees/branches.
