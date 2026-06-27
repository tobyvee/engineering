# ENG-005 — Scrub the environment for CLI agent sandboxes

- **Status:** done
- **Priority:** P1 (High — security hardening)
- **Stage:** implementation
- **Assignee role:** staff_engineer (security review by lead_system_design)
- **Area:** packages/agents

> **Outcome (Wave 1):** `CliBackend` now spawns `claude -p` with a scrubbed, allow-listed env
> (`sandboxEnv()` in `backends/cli.ts`) instead of inheriting the host environment — `ANTHROPIC_API_KEY`,
> `GITHUB_TOKEN`, `DATABASE_URL` and everything else not on the benign allow-list (PATH/HOME/XDG/locale/…)
> are withheld; the CLI still authenticates via its own login under `HOME`. Opt-in widening via
> `AGENT_SANDBOX_ENV_PASSTHROUGH`. Unit tests assert secrets are absent and passthrough works.
> *Deferred to ENG-013:* the PM-agent scoped-token exception.

## Problem

The CLI backend confines an agent's *cwd* to a throwaway sandbox, but it does not scrub the *process
environment*. `claude -p` is full Claude Code with bash + filesystem tools, and the child inherits the
host environment — so an agent can read `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`, etc. via
its bash tool and potentially exfiltrate them. The sandbox boundary is cwd-only; env and network are
not contained.

## Evidence

- `packages/agents/src/backends/cli.ts` — `spawn(this.bin, args, { cwd, signal })` passes no `env`,
  so the child inherits `process.env` in full.
- The CLAUDE.md / OVERVIEW describe the sandbox as cwd-confined; env/network isolation is not claimed
  but is implicitly assumed by "can never write to repo source."

## Proposed approach

- Pass an explicit minimal `env` to `spawn` (allow-list only what the agent legitimately needs).
- Use a scoped/short-lived `GITHUB_TOKEN` (least-privilege) rather than the full host token.
- Consider network egress restrictions for the sandbox where feasible.
- Document the sandbox's actual trust boundary (cwd + env + network) honestly.

## Acceptance criteria

- [ ] CLI-backend children run with an allow-listed environment, not the full host env.
- [ ] Host secrets (`ANTHROPIC_API_KEY`, `DATABASE_URL`, broad `GITHUB_TOKEN`) are not present in the
      agent's environment unless explicitly required and scoped.
- [ ] The documented sandbox boundary matches the implemented one.
- [ ] A test asserts a sensitive env var is absent from the spawned child's environment.

## Notes / risks

- Interacts with ENG-001 (repo-aware agents) and ENG-013 (provisioning + two-root workspace) — keep
  all three consistent in the `CliBackend.run` spawn path.
- **Controlled exception:** the PM agent's `git`/`gh` tools (ENG-013) need credentials. Grant a
  *scoped, least-privilege* `GITHUB_TOKEN`/`GH_TOKEN` to that sandbox only (repo create + read/list
  scope) — never the full host token, and not to other roles.
- Env-scrubbing applies to **both** roots — the ephemeral agent-state sandbox and the persistent
  working-code workspace.
