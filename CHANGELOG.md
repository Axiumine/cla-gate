# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Planning documents: `README.md` (product, architecture, data model, GitHub App settings, security, hook pipeline) and `CLAUDE.md` (the operating contract: hard rules and the map of the other documents).
- AGPL-3.0-only licence, with an SPDX header on every source file.
- Quality-gate toolchain: Node 26.13 and Yarn 4.18 (node-modules linker), TypeScript 6.0 with strict flags, Biome and ESLint 10 at zero warnings, Vitest with 100% v8 coverage thresholds, type-coverage per project, Knip in both modes, FTA with a score cap of 50, Lefthook pre-commit and pre-push hooks.
- CI workflow with the jobs `static` and `coverage`, least-privilege permissions and every action pinned by full commit SHA; Dependabot for GitHub Actions and npm.
- Server foundation (`src/server`, `src/shared`, `migrations/001_initial.sql`): validated configuration with redacted secrets, the Fastify app with `/healthz` and `/readyz`, security headers and one error contract, Kysely over node-postgres and PGlite, the forward-only checksummed migration runner, the whole MVP schema with immutability triggers, audited erasure and the non-owner runtime role `cla_app`, ESLint layering rules, the compose stack and the informative `postgres` CI job.
- CI runner policy and tooling: `docs/ci-runners.md` (shared self-hosted runners, the fork pull request approval gate and the hygiene rules every job follows), the `yarn ci:runners` workflow guard, random free loopback ports for CI, development and tests (`yarn ci:port`, `yarn ci:postgres`, `yarn db:up`), and a `postgres` job that starts its own database container instead of a service container.
- Structure-cap ratchet tool (`scripts/check-code-caps.ts` and `scripts/code-caps/`): file, function, class, parameter and nesting caps checked against `.code-caps-baseline.json`, with 144 tests at 100% coverage.
- Branch protection on `main`: required checks `static` and `coverage`, linear history, no force pushes or deletion, rules apply to admins.
- Epics and stories work queue in `docs/epics/`, with an index in `docs/EPICS_STORIES.md`.
- Epic E23 (Self-hosted CI runners) in the work queue, and a link to the CI runner policy at the end of the acceptance criteria of every story that writes CI jobs, containers, ports or test databases.
- This changelog.
- `CONTRIBUTING.md`: the pull request flow, the commit policy, the repository protection settings and the dependency licence rules, with the rule that every pull request adds a line under `[Unreleased]` in this changelog.
- PR evaluation engine (`src/server/domain/evaluation`, E08): a pure, deterministic function that decides whether a pull request is covered by the active CLA from plain facts, recording the covering basis of every actor (signature or allowlist), unlinked commit identities with audited per-commit overrides, `Co-authored-by` trailers resolved from the GitHub noreply form, paging rules for pull requests of up to 2,000 commits (fail closed above), and a stored-details value (`pr_evaluations.details`) bounded at 256 KiB with numeric ids and codes only.
- Audit writer (`appendAudit`) that records every mutation in the same transaction as the change, with a closed set of actions, a closed allowlist of metadata keys and values (no personal data and no IP addresses, enforced in the code and by migration 002), and a guard that stops the server from starting when a mutating `/api` route declares no audit action.
- Extended quality gates (epic E20): the escape-hatch justification gate (`yarn lint:hatches`), Semgrep, Trivy, StrykerJS mutation testing of the server and the caps tool, a real-Postgres CI job with concurrency tests, Playwright end-to-end tests with visual baselines from a digest-pinned container, memlab leak scenarios, a Qodana job that skips cleanly without `QODANA_TOKEN`, a CI contract test and Dependabot groups for lockstep packages. They run as informative CI jobs (`semgrep`, `trivy`, `postgres`, `mutation`, `e2e`, `leaks`, `qodana`) until the promotion stories make them required checks.
- GitHub App core (epic E05): the instance authenticates as one GitHub App (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, with `GITHUB_APP_PRIVATE_KEY_PREVIOUS` for a rotation without downtime) and checks its identity with GitHub at start-up; it serves several orgs, each installation a separate tenant keyed on its numeric installation id, and serves only the App owner and the accounts in `GITHUB_ALLOWED_ACCOUNT_IDS` (every other installation is recorded as rejected and never touched, also after a restart that changes the list); installation tokens are minted on demand, held in memory only and refused for a rejected, deleted or suspended installation; all GitHub calls go through one port with an Octokit adapter, per-installation rate limiting with `retry-after` and secondary-limit waits (`github.rate_limited` WARN lines) and zod-checked responses; installations, repositories, renames, transfers between tenants and removals are synced and reconciled at start-up with an audit row for every change (migrations 003 and 004).

### Changed

- The `qodana` job uploads its SARIF file as a 7-day artifact (`qodana-sarif`), so the problems of a failed scan can be read without a login to Qodana Cloud; the action's own upload stays off. First scan with the real token: 13 problems, all fixed in the same pull request; E20-S08 is Done.
- Semgrep verified on the shared runners (E20-S01 is Done after `pipx` was installed on them) and the two failures of the mutation job recorded with their causes in E20-S04 and `docs/ci-runners.md`.
- `CLAUDE.md` is now a short operating contract; commands, quality gates, architecture rules, tooling notes and the contributing flow moved to `docs/` and `CONTRIBUTING.md`.
- `README.md` is now a landing page (product, scope, quick start, documentation map); the architecture, repository layout, auth and security, data model, GitHub App, operations, toolchain, decisions and configuration sections moved to `docs/`, and `scripts/docs/doc-size.test.ts` fails when `README.md` (10240 bytes) or `CLAUDE.md` (6144 bytes) outgrows its ceiling.
