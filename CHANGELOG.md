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

### Changed

- `CLAUDE.md` is now a short operating contract; commands, quality gates, architecture rules, tooling notes and the contributing flow moved to `docs/` and `CONTRIBUTING.md`.
