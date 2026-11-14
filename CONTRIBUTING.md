# Contributing

How a change gets into `main`. The hard rules, the architecture rules and the quality gates are in [`CLAUDE.md`](CLAUDE.md), [`docs/architecture.md`](docs/architecture.md) and [`docs/quality-gates.md`](docs/quality-gates.md); read the hard rules first. [`README.md`](README.md) explains the product.

## Pull request flow

1. Branch from `main`. There are no direct pushes to `main`: every change, including docs, goes through a pull request.
2. Run `yarn gate` before you push. It is the local equivalent of the CI `static` and `coverage` jobs; `qodana` and `codeql` run in CI only (scripts and setup: [`docs/development.md`](docs/development.md)).
3. Add a line under `[Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), in the matching Keep a Changelog group (Added, Changed, Deprecated, Removed, Fixed, Security). **Every pull request does**, docs-only ones included.
4. Update the document that owns any decision you changed in the same pull request (the table in [`CLAUDE.md`](CLAUDE.md) says which one), and the epic file and index ([`docs/EPICS_STORIES.md`](docs/EPICS_STORIES.md)) when a story's status or wording changes. A story's acceptance criteria are part of its definition of done.
5. Open the pull request. `static`, `coverage`, `qodana` and `codeql` must pass and every conversation must be resolved. Merge with squash or rebase (linear history).
6. A pull request from a fork runs nothing until the maintainer has read the whole diff and approved the run (see Repository protection and [`docs/ci-runners.md`](docs/ci-runners.md)). `qodana` is red on it, by design: GitHub gives a fork pull request no secrets, and the job fails closed without `QODANA_TOKEN` (it is never skipped). The maintainer lands such a change by pushing the branch inside the repository (after reading the diff) and merging the pull request from there; a contributor does nothing about the red `qodana`.

## Commit policy

Commit or push only when asked (agents and tooling included). Do not rewrite history on shared branches. Never bypass a hook or a gate (`--no-verify`, `LEFTHOOK=0`; hard rule 1 in [`CLAUDE.md`](CLAUDE.md)). Squash or rebase merges only, because `main` keeps a linear history.

## Repository protection

Repo: `Axiumine/cla-gate` (public, `main`). Branch protection on `main`, set 2026-11-01 and applied to admins too (`enforce_admins`):

- Required status checks: `static`, `coverage`, `qodana` and `codeql` (not strict, so a branch need not be up to date; `qodana` and `codeql` were decided on 2026-11-14 and take effect when the maintainer runs the commands below). These are the exact job names the workflows must use (`static`, `coverage` and `qodana` in `ci.yml`, `codeql` in `codeql.yml`); renaming a job breaks the rule. Both of the last two fail closed: `qodana` is red when `QODANA_TOKEN` is missing (never skipped, because a skipped required job counts as passing), and `codeql` is red unless every `analyze` leg succeeded.
- Linear history required (squash or rebase merges only), force pushes and deletion blocked, conversation resolution required.
- No required reviews (single maintainer; a self-approval is impossible).
- Consequence: there are no direct pushes to `main`. Every change, including docs, goes through a PR whose four required checks pass. `.github/workflows/ci.yml` defines real `static`, `coverage` and `qodana` jobs and `.github/workflows/codeql.yml` a real `codeql` job (never placeholders that always pass); a PR can merge only while they exist and pass. `coverage` merges the reports of the `coverage shard (i/4)` jobs and must keep running when a shard fails (`if: always()`), so that a failed shard fails the check instead of skipping it.
- Emergency unblock (maintainer only, re-add the checks afterwards): `gh api -X DELETE repos/Axiumine/cla-gate/branches/main/protection/required_status_checks`. If only the Qodana licence or token lapsed, `qodana` is red for every pull request and blocks every merge (no skip): renew the secret (see Maintainer commands) or run the PATCH of step 1 without `qodana` and put it back afterwards.
- CI runs on the maintainer's shared self-hosted runners (`[self-hosted, Linux, X64]`) with the fork-PR approval gate (`all_external_contributors`) as the only protection: read the WHOLE diff before approving a fork run. Ports are random, free, loopback only, 32769-60999 (`yarn dev` and every test that listens pick one; the app's own default `PORT` 3000 for `yarn start` is the one recorded exception). Jobs have a timeout of at most 60 minutes, no `container:` or `services:`, no git hooks, and keep all tool state under `$RUNNER_TEMP`. `release.yml`, `scorecard.yml` and `codeql.yml` (any file named like them) stay on `ubuntu-24.04`, as does the `qodana` job. Full policy and the checklist: [`docs/ci-runners.md`](docs/ci-runners.md); `yarn ci:runners` guards it.
- **Stable** (a job may become required only when it is): it passed on the last 10 runs on `main` and on every pull request run of the last 7 days, with no re-run for flakiness, and its slowest run is under 80% of its `timeout-minutes`. Every promotion PR lists the evidence, the run URLs from `gh run list --workflow ci.yml --json databaseId,conclusion,createdAt,headBranch`.
- The jobs `container` (E19-S08, the container smoke test) and `caddy` (E19-S05, the validation of the proxy's configuration) are informative. `caddy` is not a required check; `container` becomes one through the promotion below once it is stable.
- **Promotion** is one PR per job, in this order: `semgrep`, `trivy`, `postgres`, `mutation`, `e2e`, `container` (E20-S10 to S15). Each PR holds the evidence; the exact `gh api` command for the maintainer (a PR cannot change repository settings) with its read-back; the documentation updates (this section, `CLAUDE.md` Branch protection, `docs/toolchain.md`, `docs/ci-runners.md`); and an independent revert. `leaks` (nightly and release) is never promoted. `qodana` and `codeql` did not go through the promotion: the maintainer made them required checks by decision on 2026-11-14 ([`docs/decisions.md`](docs/decisions.md)), because both fail closed instead of being skipped.
- **Demotion**: a required job that fails for a non-code reason twice in 7 days is removed from the required list by a PR until it is fixed, and the PR says which failures counted.
- `scripts/ci-contract.test.ts` parses the required-checks bullet of `CLAUDE.md` (Branch protection): it must keep starting `Required checks:` or `Required status checks:`, with every job name in backticks before the first opening parenthesis. The test fails when such a job is missing from its workflow (`ci.yml`, or `codeql.yml` for `codeql`), renamed, or has a job-level `if` other than `always()`.
- If this protection changes, update this section in the same PR.

## Maintainer commands

A pull request cannot change repository settings, so the maintainer runs these once, with `gh` authenticated as an admin of `Axiumine/cla-gate`. **Bootstrap order:** merge the pull request that adds `codeql.yml` and the fail-closed `qodana` job, wait until the `push` runs of both workflows on `main` have finished **and are green** (CodeQL must have uploaded a result for `main`, the check names must exist, and `qodana` must pass: a red one is a real finding or a bad token, and `enforce_admins` would then block every merge), and only then run steps 1 and 2. Afterwards bring every open pull request up to date (`@dependabot rebase` on a Dependabot PR, Update branch on the others): no event fires when `main` moves, so a head that predates `codeql.yml` never gets a `codeql` check, and its old `qodana` result came from the job that skipped without a token. Doing it earlier makes every pull request wait for a check that has never reported.

1. Required status checks (`enforce_admins` is on, so even an admin cannot bypass a red `qodana`; on a fork pull request that is by design, see Pull request flow). Read-back second:

   ```sh
   gh api -X PATCH repos/Axiumine/cla-gate/branches/main/protection/required_status_checks --input - <<'JSON'
   {"strict": false, "contexts": ["static", "coverage", "qodana", "codeql"]}
   JSON
   gh api repos/Axiumine/cla-gate/branches/main/protection/required_status_checks --jq '.contexts'
   ```

2. A ruleset with a code scanning rule (tool CodeQL, alerts of level error and security alerts of severity high or higher block the merge), no bypass actors, active. Read-back second:

   ```sh
   gh api -X POST repos/Axiumine/cla-gate/rulesets --input - <<'JSON'
   {"name": "CodeQL code scanning", "target": "branch", "enforcement": "active",
    "conditions": {"ref_name": {"include": ["refs/heads/main"], "exclude": []}},
    "rules": [{"type": "code_scanning", "parameters": {"code_scanning_tools": [
      {"tool": "CodeQL", "alerts_threshold": "errors", "security_alerts_threshold": "high_or_higher"}]}}]}
   JSON
   gh api repos/Axiumine/cla-gate/rulesets --jq '.[] | {id, name, enforcement}'
   ```

   Lift it in an emergency with `gh api -X PUT repos/Axiumine/cla-gate/rulesets/<id> -f enforcement=disabled` (and back to `active` afterwards).
3. Renew `QODANA_TOKEN` (last renewed 2026-11-14) in both secret stores when the licence is renewed or the token changes: `gh secret set QODANA_TOKEN --repo Axiumine/cla-gate` for Actions and `gh secret set QODANA_TOKEN --app dependabot --repo Axiumine/cla-gate` for Dependabot pull requests. Until then `qodana` is red everywhere.

**Never enable CodeQL default setup** (Settings, Code security) next to `codeql.yml`. GitHub then rejects the upload of the workflow ("CodeQL analyses from advanced configurations cannot be processed when the default setup is enabled"), so `codeql` goes red, and default setup skips fork pull requests. If it is on, switch it off before anything else.

## Licence and dependencies

**Licence: AGPL-3.0-only** (`LICENSE`; `package.json` `"license": "AGPL-3.0-only"`; every source file carries `// SPDX-License-Identifier: AGPL-3.0-only`). Every dependency must be AGPLv3-compatible (the same set as GPLv3: MIT, BSD, ISC, Apache-2.0, LGPL-3.0 and GPL-3.0 are fine; GPL-2.0-only is not); do not add incompatible licences (for example SSPL, BUSL, PolyForm, or Apache-1.x), and do not copy code from incompatible sources. AGPL section 13: the web UI must offer every network user the corresponding source (a visible link in the dashboard footer to the exact repository and commit). The web app's dependencies (E17, E18) are MIT, except `isbot` (Unlicense, public domain), `diff` (BSD-3-Clause), `glob` and `path-scurry` (BlueOak-1.0.0, transitive of `@fastify/static`) and `axe-core` (MPL-2.0, test-only); all are compatible. The list with the reason for each is in [`docs/toolchain.md`](docs/toolchain.md).
