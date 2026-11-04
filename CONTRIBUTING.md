# Contributing

How a change gets into `main`. The hard rules, the architecture rules and the quality gates are in [`CLAUDE.md`](CLAUDE.md), [`docs/architecture.md`](docs/architecture.md) and [`docs/quality-gates.md`](docs/quality-gates.md); read the hard rules first. [`README.md`](README.md) explains the product.

## Pull request flow

1. Branch from `main`. There are no direct pushes to `main`: every change, including docs, goes through a pull request.
2. Run `yarn gate` before you push. It is the local equivalent of the CI `static` and `coverage` jobs (scripts and setup: [`docs/development.md`](docs/development.md)).
3. Add a line under `[Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), in the matching Keep a Changelog group (Added, Changed, Deprecated, Removed, Fixed, Security). **Every pull request does**, docs-only ones included.
4. Update the document that owns any decision you changed in the same pull request (the table in [`CLAUDE.md`](CLAUDE.md) says which one), and the epic file and index ([`docs/EPICS_STORIES.md`](docs/EPICS_STORIES.md)) when a story's status or wording changes. A story's acceptance criteria are part of its definition of done.
5. Open the pull request. `static` and `coverage` must pass and every conversation must be resolved. Merge with squash or rebase (linear history).
6. A pull request from a fork runs nothing until the maintainer has read the whole diff and approved the run (see Repository protection and [`docs/ci-runners.md`](docs/ci-runners.md)).

## Commit policy

Commit or push only when asked (agents and tooling included). Do not rewrite history on shared branches. Never bypass a hook or a gate (`--no-verify`, `LEFTHOOK=0`; hard rule 1 in [`CLAUDE.md`](CLAUDE.md)). Squash or rebase merges only, because `main` keeps a linear history.

## Repository protection

Repo: `Axiumine/cla-gate` (public, `main`). Branch protection on `main`, set 2026-11-01 and applied to admins too (`enforce_admins`):

- Required status checks: `static` and `coverage` (not strict, so a branch need not be up to date). These are the exact job names the CI workflow must use; renaming a job breaks the rule.
- Linear history required (squash or rebase merges only), force pushes and deletion blocked, conversation resolution required.
- No required reviews (single maintainer; a self-approval is impossible).
- Consequence: there are no direct pushes to `main`. Every change, including docs, goes through a PR whose two checks pass. `.github/workflows/ci.yml` defines real `static` and `coverage` jobs (never placeholders that always pass); a PR can merge only while they exist and pass.
- Emergency unblock (maintainer only, re-add the checks afterwards): `gh api -X DELETE repos/Axiumine/cla-gate/branches/main/protection/required_status_checks`.
- CI runs on the maintainer's shared self-hosted runners (`[self-hosted, Linux, X64]`) with the fork-PR approval gate (`all_external_contributors`) as the only protection: read the WHOLE diff before approving a fork run. Ports are random, free, loopback only, 32769-60999 (`yarn dev` and every test that listens pick one; the app's own default `PORT` 3000 for `yarn start` is the one recorded exception). Jobs have a timeout of at most 60 minutes, no `container:` or `services:`, no git hooks, and keep all tool state under `$RUNNER_TEMP`. `release.yml` and `scorecard.yml` (any file named like them) stay on `ubuntu-24.04`. Full policy and the checklist: [`docs/ci-runners.md`](docs/ci-runners.md); `yarn ci:runners` guards it.
- **Stable** (a job may become required only when it is): it passed on the last 10 runs on `main` and on every pull request run of the last 7 days, with no re-run for flakiness, and its slowest run is under 80% of its `timeout-minutes`. Every promotion PR lists the evidence, the run URLs from `gh run list --workflow ci.yml --json databaseId,conclusion,createdAt,headBranch`.
- The jobs `container` (E19-S08, the container smoke test) and `caddy` (E19-S05, the validation of the proxy's configuration) are informative. `caddy` is not a required check; `container` becomes one through the promotion below once it is stable.
- **Promotion** is one PR per job, in this order: `semgrep`, `trivy`, `postgres`, `mutation`, `e2e`, `container` (E20-S10 to S15). Each PR holds the evidence; the exact `gh api` command for the maintainer (a PR cannot change repository settings) with its read-back; the documentation updates (this section, `CLAUDE.md` Branch protection, `docs/toolchain.md`, `docs/ci-runners.md`); and an independent revert. `leaks` (nightly and release) and `qodana` (maintainer-side) are never promoted.
- **Demotion**: a required job that fails for a non-code reason twice in 7 days is removed from the required list by a PR until it is fixed, and the PR says which failures counted.
- `scripts/ci-contract.test.ts` parses the required-checks bullet of `CLAUDE.md` (Branch protection): it must keep starting `Required checks:` or `Required status checks:`, with every job name in backticks before the first opening parenthesis. The test fails when such a job is missing from `ci.yml`, renamed, or has a job-level `if`.
- If this protection changes, update this section in the same PR.

## Licence and dependencies

**Licence: AGPL-3.0-only** (`LICENSE`; `package.json` `"license": "AGPL-3.0-only"`; every source file carries `// SPDX-License-Identifier: AGPL-3.0-only`). Every dependency must be AGPLv3-compatible (the same set as GPLv3: MIT, BSD, ISC, Apache-2.0, LGPL-3.0 and GPL-3.0 are fine; GPL-2.0-only is not); do not add incompatible licences (for example SSPL, BUSL, PolyForm, or Apache-1.x), and do not copy code from incompatible sources. AGPL section 13: the web UI must offer every network user the corresponding source (a visible link in the dashboard footer to the exact repository and commit). The web app's dependencies (E17) are MIT, except `isbot` (Unlicense, public domain), `glob` and `path-scurry` (BlueOak-1.0.0, transitive of `@fastify/static`) and `axe-core` (MPL-2.0, test-only); all are compatible. The list with the reason for each is in [`docs/toolchain.md`](docs/toolchain.md).
