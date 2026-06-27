# ENG-003 — Add CI for this repository

- **Status:** done
- **Priority:** P1 (High)
- **Stage:** implementation
- **Assignee role:** lead_engineer
- **Area:** repo / .github

> **Outcome (Wave 0):** `.github/workflows/ci.yml` runs typecheck · lint · test · build on PRs/pushes
> to `main` (Node from `.nvmrc`, `--frozen-lockfile`, pnpm + Turborepo caching). All four checks
> verified green locally (51 tests). CI badge + branch-protection note added to the root `README.md`.
> Branch protection itself is a one-time GitHub repo setting (cannot be committed).

## Problem

There is no continuous integration for this repository itself — `.github/` does not exist, and
`docs/OVERVIEW.md` explicitly lists "No remote / CI for this repo itself" as a known gap. For a
product whose entire premise is CI-gated delivery, dogfooding a CI pipeline is both low-effort and
high-signal, and it prevents the quality gates (`typecheck` / `lint` / `test` / `build`) from
silently regressing.

## Evidence

- `.github/` — absent.
- `docs/OVERVIEW.md` → "Not yet built (honest gaps)" → "No remote / CI for this repo itself."
- `package.json` already defines `typecheck`, `lint`, `test`, `build` scripts (Turborepo).

## Proposed approach

Add a GitHub Actions workflow (`.github/workflows/ci.yml`) that, on push/PR:

- sets up Node (per `.nvmrc`) + pnpm,
- `pnpm install --frozen-lockfile`,
- runs `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Cache pnpm + Turborepo for speed. Consider a Postgres/Temporal services matrix only once ENG-002 adds
integration-level tests that need them (unit tests should not require live services).

## Acceptance criteria

- [ ] `.github/workflows/ci.yml` runs typecheck + lint + test + build on every PR to `main`.
- [ ] The workflow uses the Node version from `.nvmrc` and a frozen lockfile.
- [ ] A red check blocks merge (branch protection note added to README/CLAUDE.md).
- [ ] Build/test caching configured so CI is reasonably fast.

## Notes / risks

- Once green, this becomes the reference `GITHUB_DEPLOY_WORKFLOW`-adjacent example for the product's
  own delivery loop.
