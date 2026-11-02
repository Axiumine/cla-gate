# CLAUDE.md

Operating contract for Claude Code and humans. CLA Platform: a GitHub App plus React dashboard that enforces Contributor License Agreements on pull requests; every PR gets a `license/cla` Check Run. Stack: Node 26 LTS, Yarn 4, TypeScript 6.0.x, React 19 + Vite 8, Fastify 5, PostgreSQL 18, Kysely, pg-boss.

**Licence: AGPL-3.0-only**; every source file starts with `// SPDX-License-Identifier: AGPL-3.0-only`. AGPL section 13: the web UI offers every network user the corresponding source (a visible dashboard footer link to the exact repository and commit).

**Status:** server foundation built, product not built, no placeholders ([details](docs/development.md#status)).

## Where things are

| Document | What it holds |
|---|---|
| [`README.md`](README.md) | Landing page: product, scope, quick start, documentation map |
| [`docs/development.md`](docs/development.md) | Status, setup and run, every `package.json` script (exists or deferred) |
| [`docs/configuration.md`](docs/configuration.md) | Environment variables |
| [`docs/architecture.md`](docs/architecture.md) | Stack, layering, PR check flow, rules (webhooks, evaluation, auth, cookies, start-up) |
| [`docs/data-model.md`](docs/data-model.md) | Tables, immutability, erasure, database roles |
| [`docs/security.md`](docs/security.md) | Auth model, role matrix, security and privacy |
| [`docs/github-app.md`](docs/github-app.md) | App permissions, events, check name, rules |
| [`docs/operations.md`](docs/operations.md) | Key rotation, backups, poison jobs |
| [`docs/decisions.md`](docs/decisions.md) | Decisions and reasons, open questions (legal) |
| [`docs/repository-layout.md`](docs/repository-layout.md) | The directory tree |
| [`docs/quality-gates.md`](docs/quality-gates.md) | Thresholds, TypeScript setup, testing conventions, escape hatches |
| [`docs/toolchain.md`](docs/toolchain.md) | Tool evaluation, hook pipeline, CI jobs |
| [`docs/tooling-gotchas.md`](docs/tooling-gotchas.md) | Tool facts and traps, GitNexus, open verifications |
| [`scripts/code-caps/README.md`](scripts/code-caps/README.md) | The structure-cap ratchet tool (`yarn caps`) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | PR flow, branch protection, commit policy, changelog rule, licences |
| [`docs/ci-runners.md`](docs/ci-runners.md) | CI runner policy, fork-PR approval |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes; every PR adds a line under `[Unreleased]` |
| [`docs/EPICS_STORIES.md`](docs/EPICS_STORIES.md) | Work queue (`docs/epics/`); acceptance criteria are part of the definition of done |

`README.md` (at most 10240 bytes) and this file (at most 6144) stay short on purpose; `scripts/docs/doc-size.test.ts` enforces both.

## Hard rules (non-negotiable)

1. **Never bypass a gate.** No `--no-verify`, no `LEFTHOOK=0`, no lowering a threshold, no growing `.code-caps-baseline.json` (it may only shrink), no excluding files from coverage. Fix the code. Agents never run `--init`, `--force` or `--update-baseline` of the caps tool to hide a violation. Only exceptions: `LEFTHOOK_EXCLUDE=trivy,semgrep` when offline (CI still enforces them) and the fixed coverage exclusion list ([quality gates](docs/quality-gates.md), Thresholds).
2. **100% means real.** Every behaviour change ships with tests that assert behaviour; tests that merely execute lines die in mutation testing.
3. **No escape hatches without a reason.** `any`, `as`, `@ts-expect-error`, `eslint-disable`, `biome-ignore`, `v8 ignore` are last resorts, each with a written justification on the same line (`v8 ignore` also needs `-- @preserve`; `reportUnusedDisableDirectives` stays on); prefer zod parsing and type guards. Detail: [quality gates](docs/quality-gates.md), Escape hatches.
4. **Identity is the numeric GitHub id.** Never key signatures, allowlists or approvals on login or email; they are display snapshots.
5. **The signature core, CLA versions and audit rows are immutable** (DB triggers block UPDATE beyond `revoked_*`, DELETE and TRUNCATE; the runtime DB role must not own the tables). Personal data (name, email, login) lives only in the erasable `signer_pii` table, never in the core or `audit_log`; erasure goes through one audited SQL function. Migrations must not weaken any of this. Revocation is prospective only.
6. **Migrations are forward-only.** Never edit a merged migration; add a new one.
7. **No secrets in the repo or logs.** App private key, webhook secret, client secret, session secret live in env or a secret manager. Never log tokens, emails or request bodies. Do not store GitHub user tokens.
8. **New dependency needs justification** (Knip, Trivy, supply-chain cost) **and an AGPLv3-compatible licence** ([list](CONTRIBUTING.md#licence-and-dependencies)). Do not disable Yarn's `npmMinimalAgeGate` (default 1 day).
9. **Commit or push only when asked.** Do not rewrite history on shared branches.
10. **Keep the documents true.** Every PR adds a line under `[Unreleased]` in `CHANGELOG.md`.

## Cross-cutting rules (detail: [`docs/architecture.md`](docs/architecture.md))

- Layering: `src/shared` imports neither `src/server` nor `src/web`; `src/web` and `src/server` never import each other; decision logic is pure in `src/server/domain`, I/O only in `src/server/adapters`.
- Immutability and identity: hard rules 5 and 4.
- Tenancy: every query filters by installation id; cross-tenant tests are mandatory.
- Boundaries: validate every external input (HTTP, webhooks, GitHub API responses, env) with zod; share schemas through `src/shared`.

## Branch protection

- No direct pushes to `main`: every change goes through a PR whose checks pass.
- Required checks: `static` and `coverage` (exact job names; renaming one breaks the rule).
- Flow, emergency unblock and commit policy: [`CONTRIBUTING.md`](CONTRIBUTING.md); runners and fork approval: [`docs/ci-runners.md`](docs/ci-runners.md).

A changed decision updates the owning document above in the same PR.
