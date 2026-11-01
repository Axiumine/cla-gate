# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Planning documents: `README.md` (product, architecture, data model, GitHub App settings, security, hook pipeline) and `CLAUDE.md` (the operating contract: commands, hard rules, thresholds, tooling gotchas).
- AGPL-3.0-only licence, with an SPDX header on every source file.
- Quality-gate toolchain: Node 26.13 and Yarn 4.18 (node-modules linker), TypeScript 6.0 with strict flags, Biome and ESLint 10 at zero warnings, Vitest with 100% v8 coverage thresholds, type-coverage per project, Knip in both modes, FTA with a score cap of 50, Lefthook pre-commit and pre-push hooks.
- CI workflow with the jobs `static` and `coverage`, least-privilege permissions and every action pinned by full commit SHA; Dependabot for GitHub Actions and npm.
- Structure-cap ratchet tool (`scripts/check-code-caps.ts` and `scripts/code-caps/`): file, function, class, parameter and nesting caps checked against `.code-caps-baseline.json`, with 144 tests at 100% coverage.
- Branch protection on `main`: required checks `static` and `coverage`, linear history, no force pushes or deletion, rules apply to admins.
- Epics and stories work queue in `docs/epics/`, with an index in `docs/EPICS_STORIES.md`.
- This changelog.
