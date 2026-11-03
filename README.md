# CLA Platform

Contributor License Agreements for GitHub projects. Maintainers publish a CLA, contributors sign it once with their GitHub account, and every pull request gets an automatic `license/cla` check.

> **Status: server foundation built, product not built.** Toolchain, configuration, health routes and the database schema are green; the job queue, signing and web UI are not built yet, while the GitHub App core, the webhook intake and the login are ([details](docs/development.md#status)). Versions, flags and config keys verified 2026-11-01. This is not legal advice: have counsel review any CLA text you publish.

## Why another CLA tool

As of 2026-11 CLA Assistant is near-dormant, `contributor-assistant/github-action` is archived and EasyCLA is a heavyweight platform for Linux Foundation projects ([evidence](docs/decisions.md#why-another-cla-tool)). What it does differently:

- Signatures are **append-only Postgres rows** keyed on the immutable GitHub numeric user id, with the CLA version and the SHA-256 of the exact text shown.
- **Immutable CLA versions**. Only a major bump forces re-signing; typo fixes do not.
- Prospective **revocation and admin invalidate / re-sign**.
- A **GitHub App** (Check Runs, least-privilege), not broad OAuth scopes.
- Org-member exemption that works for **private** membership.
- Clear guidance and an admin override for the top real-world failure: **commits whose email is not linked to a GitHub account**.

## Scope

### MVP (v0.1)

- GitHub login for maintainers and contributors (GitHub App user authorization).
- GitHub App installation on orgs and repos; maintainer dashboard to enable repos.
- Individual CLA: versioned markdown documents uploaded by the maintainer (no legal text is shipped by default).
- Contributor signing page: read, consent, typed name, verified GitHub email.
- PR evaluation on every `pull_request` event, a `license/cla` Check Run, and a single upserted PR comment with a sign link.
- Allowlist: bots (by account type and numeric id), org members, named users.
- `/recheck` comment and the Check Run "Re-run" button.
- Dashboard: repos, signatures, pending PRs, CSV export, revoke, audit log.

### Later

- Corporate CLA: a signatory becomes CLA manager and approves employees by GitHub username, verified email domain, or GitHub org (EasyCLA-style ICLA / CCLA / employee flow).
- Merge queue support (`merge_group.checks_requested`).
- Public signature-verification endpoint and badge.
- Retention and erasure tooling (GDPR).

### Non-goals

- Shipping legal text. Reuse terms of the Apache ICLA text were not confirmed; Harmony v1.0 (2011) is CC BY 3.0 and dated. Admins upload their own.
- Non-GitHub forges (GitLab, Gitea) in v1.
- Storing GitHub user tokens. The user token is used once at login to read identity and verified emails, then discarded.

## How it works

1. A pull request is opened or updated; GitHub sends an HMAC-signed webhook.
2. The API verifies it, records the delivery and enqueues a job in one transaction, and answers 2xx within 10 s.
3. The worker (pg-boss) re-fetches the PR and resolves the opener and every non-exempt commit author and committer to numeric GitHub ids.
4. It checks signatures, allowlist and approvals, then upserts the `license/cla` Check Run and one PR comment with a sign link.
5. The contributor logs in with GitHub and consents to the current CLA version; the API appends an immutable signature.
6. Their open PRs are re-evaluated and the check turns `success`; `/recheck` forces another pass.

Rules and sequence diagram: [`docs/architecture.md`](docs/architecture.md#how-a-pull-request-is-checked).

## Quick start

Prerequisites: Node 26.13 ([mise](https://mise.jdx.dev) or `.nvmrc`), Corepack (`npm install -g corepack && corepack enable`; Node 26 no longer bundles it) and Docker.

Operators: `docker compose up --build` will build and start the whole stack from a checkout ([E19](docs/epics/E19.md), planned: today there is no `Dockerfile` and `docker-compose.yml` is the development database only).

Developers:

```sh
yarn install --immutable   # also installs the git hooks
yarn db:up                 # PostgreSQL 18 on a random free loopback port
yarn db:migrate            # applies migrations/ as the owner role, then installs the job queue
yarn dev                   # server with --watch; prints its address (try /readyz)
```

More: [`docs/development.md`](docs/development.md) (setup, scripts) and [`docs/configuration.md`](docs/configuration.md) (environment variables).

## Architecture

- One Node 26 service: Fastify serves the API and the built React SPA from one origin.
- PostgreSQL 18 (Kysely, forward-only migrations) holds the data and the pg-boss job queue; there is no Redis.
- GitHub reaches it through one GitHub App; webhooks are verified by HMAC and never trusted for state.
- Layers, enforced by ESLint: `src/server/domain` is pure decision logic with no I/O, `services` orchestrate, `adapters` are the only place with I/O, `src/web` is the SPA, `src/shared` holds the zod schemas both sides use.
- Stack table, layering and rules: [`docs/architecture.md`](docs/architecture.md). Schema: [`docs/data-model.md`](docs/data-model.md). Tree: [`docs/repository-layout.md`](docs/repository-layout.md).

## GitHub App

A least-privilege App: Pull requests read and write, Checks write; Issues, Members and Metadata read; Email addresses read at login only. It subscribes to `pull_request`, `check_run`, `check_suite` and `issue_comment`. The check name is the constant `license/cla`. Permissions, events, rules: [`docs/github-app.md`](docs/github-app.md).

## Quality gates

Everything is strict by default: 100% coverage and type coverage, zero lint findings, no unused code, ratcheted structural caps. Hooks give fast feedback, CI is authoritative, and `yarn gate` runs its `static` and `coverage` jobs locally. Thresholds: [`docs/quality-gates.md`](docs/quality-gates.md). Tools, hooks, CI jobs: [`docs/toolchain.md`](docs/toolchain.md).

## Documentation map

This README and the documents below are the source of truth for scope, stack and quality gates.

| Document | What it holds |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Operating contract: hard rules |
| [CONTRIBUTING.md](CONTRIBUTING.md) | PR flow, branch protection, dependency licences |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |
| [docs/development.md](docs/development.md) | Status, setup, every `package.json` script |
| [docs/configuration.md](docs/configuration.md) | Environment variables |
| [docs/architecture.md](docs/architecture.md) | Stack, layering, PR check flow, rules |
| [docs/repository-layout.md](docs/repository-layout.md) | The directory tree |
| [docs/data-model.md](docs/data-model.md) | Tables, immutability, erasure, roles |
| [docs/security.md](docs/security.md) | Auth model, role matrix, privacy |
| [docs/privacy.md](docs/privacy.md) | Privacy notes for operators: inventory, retention, erasure, backups |
| [docs/github-app.md](docs/github-app.md) | Permissions, events, check name, rules |
| [docs/operations.md](docs/operations.md) | Key rotation, backups, poison jobs |
| [docs/quality-gates.md](docs/quality-gates.md) | Thresholds, TypeScript, testing |
| [docs/toolchain.md](docs/toolchain.md) | Tools, hook pipeline, CI jobs |
| [docs/tooling-gotchas.md](docs/tooling-gotchas.md) | Tool traps, open verifications |
| [docs/ci-runners.md](docs/ci-runners.md) | CI runner policy, fork-PR approval |
| [docs/decisions.md](docs/decisions.md) | Decisions, open questions |
| [docs/EPICS_STORIES.md](docs/EPICS_STORIES.md) | Epics, stories, acceptance criteria |
| [scripts/code-caps/README.md](scripts/code-caps/README.md) | The structure-cap ratchet (`yarn caps`) |

## Roadmap

1. **Scaffold**: toolchain, hooks and CI passing every gate at 100% (done), and the server foundation: configuration, logging, security headers, health routes, the schema and its migration runner, Postgres 18 in the tests (done). Semgrep, Trivy, Stryker, Playwright, memlab and Qodana are wired with their CI jobs (Qodana waits for a licence and token).
2. **Core**: GitHub App, webhook intake, PR evaluation, Check Run and comment.
3. **Signing**: login, CLA versions, consent flow, signature storage.
4. **Dashboard**: repos, signatures, CSV export, revoke, audit log.
5. **Hardening**: promote the stable CI jobs to required checks, raise the mutation floor, e2e and visual baselines for every screen, memlab nightly, Qodana once licensed.
6. **Corporate CLA** and merge queue support.

## License

[GNU Affero General Public License v3.0](LICENSE), SPDX identifier `AGPL-3.0-only`. `package.json` sets `"license": "AGPL-3.0-only"`. Dependencies must be AGPLv3-compatible (the same set as GPLv3: permissive licences such as MIT, Apache-2.0 and BSD are fine).

Why AGPL and not GPL: this is a network service. Under GPLv3, someone could run a modified copy as a hosted CLA service without publishing their changes; AGPLv3 section 13 closes that. The dashboard therefore links to the corresponding source. Running it unmodified for your own repositories, or self-hosting it inside your company, needs nothing beyond keeping that link.
