# ENG-017 — Local-git DeliveryAdapter (commit without GitHub)

- **Status:** done
- **Priority:** P1 (unblocks a real end-to-end run with no GitHub account)
- **Stage:** implementation
- **Assignee role:** staff_engineer (with lead_system_design input)
- **Area:** packages/integrations · apps/server

## Problem

A live run without GitHub couldn't produce real code: delivery is GitHub-API-only (the sole
`DeliveryAdapter` is `GitHubDeliveryAdapter`, whose `commitFiles` uses the GitHub Git Data API). With
no `GITHUB_*` configured, `deliveryFromEnv()` returns `null`, the coding agent's proposed `files[]` are
**discarded**, and the QA agent (tool-less `api` backend) has nothing to verify — so every ticket
reworks to the cap and `blocked`. (Confirmed in a live run: 6/6 tickets blocked, ~$2 spent on doomed
rework.)

## Outcome (built)

A **`LocalGitDeliveryAdapter`** behind the existing `DeliveryAdapter` port — no GitHub account/remote
needed, so a ticket can reach `done` entirely offline with real, inspectable code on disk.

- **`packages/integrations/src/local/delivery.ts`** — implements the full port with local `git`:
  `createBranch` (`git branch -f`), `commitFiles` (`checkout -f` → write files → `add -A` → `commit`,
  returns the SHA), `openPullRequest` (synthetic `file://` ref), `getChecks` (`[]` → success), `merge`
  (local `--no-ff` into the base branch); deploy hooks are no-ops. Commit identity is supplied
  per-commit so a fresh `git init` needs no global config; writes are path-traversal-guarded.
- **Concurrency-safe:** all git ops run through an in-process queue (the worker is one process) and each
  `commitFiles`/`merge` is a self-contained `checkout -f → … → commit` unit, so the heartbeat
  auto-starting all backlog tickets can't corrupt the shared repo.
- **`localGitBranchFiles(repoDir, branch)`** — reads a branch's committed files via git (not the
  working tree, so it's concurrency-safe), bounded by file count/size.
- **Wiring (`activities.ts`):** `deliveryFromEnv()` returns the local adapter when
  `DELIVERY_BACKEND=local` (repo at `workspace/<owner|local>/<repo|app>`); `implementTicket` needs no
  change — the port abstraction means it commits to the local repo. **QA now verifies real code:**
  `verifyTicket` injects the committed files into the assess prompt (and says "nothing to verify" when
  none) so the tool-less `api` backend can actually check the work — addressing the doomed-rework cost.
- **Ops:** `DELIVERY_BACKEND` passthrough + a `./workspace` bind-mount in compose (so the committed
  repo is visible on the host); `.env.example` documents it.

## Verification

- Real-git unit tests (`delivery.test.ts`): commit→branch→merge, concurrent commits don't
  cross-contaminate, path-traversal rejected, missing repo/branch → `[]`.
- typecheck · lint · full test suite green.

## Deferred / notes

- **Live run needs the worker fix too** (separate PR, `fix/worker-temporal-connection`) — without it
  the worker can't reach Temporal in Docker.
- `getChecks` returns success (no local CI). A natural follow-up: run the target repo's tests as the
  "CI" check before the merge gate.
- The `cli` backend would make this even stronger (it edits files in the repo cwd directly); this
  ticket makes the `api` backend path work end-to-end.
