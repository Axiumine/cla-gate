# CLA Platform

Contributor License Agreements for GitHub projects. Maintainers publish a CLA, contributors sign it once with their GitHub account, and every pull request gets an automatic `license/cla` check.

> **Status: server foundation.** The toolchain (Yarn 4, TypeScript, Biome, ESLint, Vitest at 100%, type-coverage, Knip, FTA, the caps ratchet, Lefthook hooks, GitHub Actions CI) is in place and green on everything that exists: the code-caps tool and the server foundation (configuration, structured logging, security headers, health routes, the PostgreSQL schema with its migration runner, and a Postgres 18 test setup). The GitHub App, webhooks, jobs, login, signing and the web UI are not built yet. This README and [`CLAUDE.md`](CLAUDE.md) are the source of truth for scope, stack and quality gates. Version numbers, flags and config keys below were verified against live sources on 2026-11-01. This is not legal advice: have counsel review any CLA text you publish.

## Why another CLA tool

As of 2026-11 the common options are ageing or limited:

- **CLA Assistant** (SAP): not archived but near-dormant. No commits between 2023-10 and 2026-10, Node 16 / AngularJS stack. Stores the CLA as a Gist and signatures in MongoDB. Cannot invalidate or re-sign a signature (issue #380), and re-prompts on *any* Gist edit.
- **contributor-assistant/github-action**: archived 2026-03-23. Stores signatures as JSON in a repo branch. No CLA version or text hash recorded.
- **EasyCLA** (Linux Foundation): active, but a heavyweight AWS/DocuSign platform built for LF projects.

What this project does differently:

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

```mermaid
sequenceDiagram
    actor C as Contributor
    participant GH as GitHub
    participant API as CLA API (Fastify)
    participant W as Worker (pg-boss)
    participant DB as PostgreSQL

    C->>GH: open or update pull request
    GH->>API: webhook pull_request (HMAC signed)
    API->>DB: record delivery id (idempotent)
    API->>W: enqueue evaluate-pr
    API-->>GH: 2xx (limit is 10 s)
    W->>GH: list PR commits, resolve authors
    W->>DB: signatures, allowlist, approvals
    W->>GH: upsert Check Run license/cla and PR comment
    C->>API: open sign link, log in with GitHub
    C->>API: consent to current CLA version
    API->>DB: append signature (immutable)
    API->>W: re-evaluate this contributor's open PRs
    W->>GH: update Check Run to success
```

A PR passes when the **PR opener** and every non-exempt **commit author and committer** is linked to a GitHub user with a valid signature for the repo's active CLA. Covered means: same document, and the signature's major version equals the active major (minor edits never force re-signing). Commit emails are spoofable (anyone can commit as a signer's `ID+login@users.noreply.github.com`), which is why the opener must always be covered too. The committer is exempt when it equals the author or is GitHub's `web-flow` identity (id to verify at scaffold); merge commits are skipped. With corporate CLAs (later), a valid individual signature **or** a valid corporate approval covers an author.

Outcomes: `success` (all covered), `failure` (unsigned authors and unlinked emails, listed with exact fix steps), and `in_progress` while a job runs. Each evaluation records its covering basis (signature, approval, allowlist rule or override) in `pr_evaluations`. A null commit author means an unlinked email: a blocking failure unless a maintainer records an audited per-commit override (repo plus commit SHA), which never implies a signature. `Co-authored-by` trailers carry only name and email, so they are resolved only in the `ID+login@users.noreply.github.com` form; otherwise they are advisory notes, never blocking. Bot and AI trailers are ignored. PRs with more than 250 commits fall back to paging the repo commits endpoint (the PR commits endpoint caps at 250). Jobs always re-fetch current PR state and never trust the webhook payload.

## Architecture

| Layer | Choice |
|---|---|
| Runtime | Node.js 26 LTS (26.13.0 "Lithium", LTS since 2026-10-28), ESM only |
| Package manager | Yarn 4 (Berry) via Corepack, `nodeLinker: node-modules` |
| Language | TypeScript `~6.0.x`, strict (see [Decisions](#decisions)) |
| Web | React 19.3, Vite 8 (Rolldown), TanStack Router (code-based) and Query 5, React Hook Form + zod, Tailwind CSS 4, `radix-ui` primitives |
| API | Fastify 5, `fastify-type-provider-zod` + zod 4, `@fastify/cookie`, `helmet`, `rate-limit`, `csrf-protection`, `fastify-raw-body`, `@fastify/static` |
| Database | PostgreSQL 18, Kysely, forward-only SQL migrations |
| Jobs | pg-boss (queue lives in Postgres, no Redis) |
| GitHub | GitHub App, `octokit` + `@octokit/webhooks` (ESM only) |
| Tests | Vitest 5 (`scripts`, `server` and later `web` projects), Testing Library, MSW 3, PGlite, Playwright |
| Deploy | Single container: Fastify serves API and the built SPA from one origin |

### Layering

```text
src/server/domain     pure functions (PR evaluation, coverage rules) - no I/O
src/server/services   orchestration, depends on ports
src/server/adapters   github/, db/, http/ routes, jobs/ - the only places with I/O
src/web               React SPA, talks to the API only through src/shared schemas
src/shared            zod schemas and API contract types; imports neither server nor web
```

Boundaries are enforced by ESLint, one block per directory (`scripts/eslint-layers.ts`, with a test that lints real snippets for every direction). The rules match relative specifiers only, so `node:stream/web` or `react-dom/server` are not mistaken for `src/web` and `src/server`, and they cover dynamic `import()` too. `src/server/domain` has an allow-list rather than a list of banned modules: it may import its own files, `src/shared` and `zod`, nothing else (no Node built-in, no I/O library, no `app`, `boot`, `config`, `adapters` or `services`), and it may not use `fetch`, `process`, `require` or the global object. Keeping the decision logic pure makes the 100% coverage and mutation gates cheap to satisfy honestly.

### Repository layout

Items marked (planned) do not exist yet.

```text
.
├── src/server/                  Fastify app; unit tests co-located as *.test.ts
│   ├── main.ts  migrate.ts      process entries (kept logic-free; covered by boot tests)
│   ├── boot.ts  app.ts          start-up and signals; the Fastify instance (buildApp)
│   ├── config/                  environment parsing (zod), Secret, TRUST_PROXY parsing
│   ├── adapters/db/             Kysely over node-postgres, hand-written schema types, migration runner and CLI,
│   │                            PGlite dialect and test helpers (test only, outside the build)
│   ├── adapters/http/           logger, request ids, security headers, error handling (also for failures that never
│   │                            reach a route), HTTP limits, health routes
│   └── domain/, services/       (planned) pure decision logic; orchestration
├── src/shared/                  zod schemas shared by server and web (health, error body)
├── src/web/                     (planned) React SPA
├── migrations/                  forward-only SQL, never edited after merge (001_initial.sql)
├── docker/postgres-init.sql     creates the unprivileged dev role cla_app (see docker-compose.yml)
├── docker-compose.yml           local PostgreSQL 18
├── scripts/eslint-layers.ts     the layering rules of the ESLint config, and their test
├── scripts/check-code-caps.ts   structure-cap ratchet, entry (runs natively on Node 26)
├── scripts/code-caps/           its modules (types, naming, nesting, collector, measure, files, baseline,
│                                report, cli) and tests; a port of the Python tool
├── types/                       ambient .d.ts for tools without types (eslint-plugin-no-unsanitized)
├── e2e/                         (planned) Playwright specs and visual baselines
├── tests/leaks/                 (planned) memlab scenarios and the @memlab/api wrapper
├── LICENSE                      AGPL-3.0-only
├── rules/                       (planned) Semgrep rules cache (git-ignored, never committed)
├── .github/workflows/ci.yml     jobs static, coverage and postgres; .github/dependabot.yml
├── .code-caps-baseline.json
├── lefthook.yml  biome.json  eslint.config.mjs  fta.json  knip.json  vitest.config.ts
├── stryker.config.mjs  playwright.config.ts  qodana.yaml  vite.config.ts      (planned)
├── .semgrepignore  .trivyignore  Dockerfile                                   (planned)
├── .nvmrc  mise.toml  .yarnrc.yml  package.json  yarn.lock  .gitattributes
├── tsconfig.json                solution-style root (files: [])
├── tsconfig.base.json  tsconfig.server.json  tsconfig.server.test.json
├── tsconfig.scripts.json  tsconfig.node.json
├── README.md  CLAUDE.md
```

The server compiles with `tsconfig.server.json` (composite, emits `dist/`, excludes tests, test helpers and the PGlite adapter). `tsconfig.server.test.json` type-checks the same sources plus every test, and ESLint and type-coverage run over both.

### Auth model

Backend-for-frontend: the SPA never holds tokens. Login uses GitHub App user authorization with a short-lived `Lax` state cookie and PKCE. The API reads the identity and verified emails, rotates to a **new** session id, and issues a server-side session (Postgres) in a `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie with idle and absolute expiry. The session cookie is `Lax` rather than the `Strict` that RFC 10017 prefers because contributors arrive from a cross-site link (the sign link in the PR comment) and must be recognised on that first navigation; the deviation is compensated by a CSRF token plus `Origin` check on every state-changing request (the webhook route is exempt and relies on its HMAC). `return_to` accepts relative paths only, nothing mutates on GET, and sessions are deleted on a `github_app_authorization` revoke event.

Authorization is derived from GitHub with the **installation token** and numeric ids (org role via the memberships API, repo permission via the collaborators permission API), cached with a short TTL.

| Action | Required role |
|---|---|
| View signatures, export CSV, revoke, invalidate (installation-scoped CLA) | org admin of the installation |
| Same, repo-scoped CLA | repo admin |
| Publish CLA version, edit allowlist, record override | same as above |
| Sign a CLA, view own signatures | any authenticated GitHub user |

Every query is filtered by installation id and covered by cross-tenant tests. Uninstall and repo transfer are handled explicitly (suspend, then retain signatures).

## Data model

| Table | Purpose and key constraints |
|---|---|
| `users` | GitHub account snapshot. `github_id` bigint UNIQUE is the identity key; login, name and avatar are display snapshots only |
| `sessions` | Server-side sessions: hashed session id, expiry, CSRF secret |
| `installations` | GitHub App installation: `github_installation_id` UNIQUE, account id, login, type, `suspended_at` |
| `repositories` | `github_repo_id` UNIQUE, installation, `full_name` snapshot, `enabled`, active CLA document |
| `cla_documents` | Named CLA per installation or repo; kind is individual or corporate. `installation_id` and `kind` never change (trigger). The active version only moves forward: it must be the document's highest (major, minor) |
| `cla_versions` | Immutable once published (DB trigger): unique (document, major, minor), `content_md`, `content_sha256`, publisher, rationale, `published_at`. The document points at the active version; a rollback publishes a new version, never reactivates an old one (a trigger refuses to point at anything but the highest version). `published_at` must be within five minutes of the database clock |
| `signatures` | Immutable core: user id, version, text hash, consent text id, `signed_at` UTC, signer type, source repo and PR, plus `revoked_at`, `revoked_by`, reason (the only mutable columns; the reason is a code from a fixed set, never free text, because a revoked row can never be scrubbed). The document's kind must equal `signer_type` (composite foreign key), `revoked_at` cannot precede `signed_at`, and `signed_at` must be within five minutes of the database clock. Partial unique index on (user, document, major) where not revoked. The sign request carries the version id and hash, verified server-side |
| `signer_pii` | Erasable personal data for a signature: name, verified email and login snapshots. Split out so GDPR erasure never touches the immutable core |
| `commit_overrides` | Audited maintainer override per (repo, commit SHA); never implies a signature |
| `corporate_agreements`, `corporate_approvals` | Phase 2: company CCLA and manager-approved employees |
| `allowlist_entries` | Scope (installation or repo), kind (user, bot, org members), numeric GitHub id, never a login string |
| `pr_evaluations` | Unique (repo, PR number, head SHA): result, details, `check_run_id`, `comment_id` |
| `webhook_deliveries` | `delivery_id` PK for idempotency (GitHub reuses the id on redelivery), event, received and processed times |
| `audit_log` | Append-only: actor numeric id, action, subject ids, metadata. **No personal data**: metadata is a flat object whose keys come from a fixed list and whose values are numbers, booleans, null or lower-case codes (`audit_metadata_is_clean`); a new key needs a migration |
| `pgboss.*` | Queue schema owned by pg-boss |

Immutability is enforced by DB triggers that block `UPDATE` (beyond the allowed columns), `DELETE` and `TRUNCATE`; the runtime DB role does not own the tables, so it cannot disable triggers. The identity columns the rest of the schema hangs on (`users.github_id`, `installations.github_installation_id` and `account_id`, `repositories.github_repo_id` and `installation_id`, `cla_documents.installation_id` and `kind`) cannot be updated either, although the runtime role may update the other columns of those tables: re-pointing a GitHub id would re-attribute every signature that references the row. Erasure goes through one audited SQL function (`erase_signer_pii`) that deletes the person's `signer_pii` rows and sessions, scrubs the display snapshot in `users` and keeps the minimal signature core (GDPR Art. 17(3)(e), legal claims). A `signer_pii` row cannot be stored for a signature that predates the person's erasure (trigger), so a signing request that was in flight during the erasure cannot write the data back. The acting administrator is a required argument; it is the caller's attribution, which the database cannot verify, and the audit row is append-only rather than hash-chained. Other text that is not signer data and is outside erasure: `installations.account_login` and `repositories.full_name` (public names of the maintainers' accounts and repositories; for a user-type installation that is the maintainer's own login) and `commit_overrides.reason` (a maintainer's note). `pr_evaluations.details` must hold numeric ids and codes only; the slice that writes it enforces that.

`migrations/001_initial.sql` creates every table above except `corporate_agreements`, `corporate_approvals` (phase 2) and `pgboss.*` (pg-boss creates its own schema). Tenant tables carry `installation_id` and tie it to their parent with composite foreign keys, so a row can never point at another tenant's repository or document. Two roles: the migration owner (`MIGRATION_DATABASE_URL`) owns the schema; the runtime role `cla_app` (`DATABASE_URL`) gets only the privileges it needs, granted by the migration when the role exists. The runner (`src/server/adapters/db/migrator.ts`) holds a session advisory lock, applies each file in its own transaction, records a SHA-256 checksum in `schema_migrations`, and refuses to run when an applied file changed, went missing or sorts before an applied one. bigint columns come back as JS numbers (GitHub ids are far below 2^53) and a value outside the safe range throws instead of rounding.

Revocation is prospective: `revoked_at` marks the signature invalid for *future* PRs; contributions already accepted stay licensed. Network metadata (IP, user agent) is **off by default**; if enabled it needs a documented legitimate interest and short retention (Art. 5(1)(c), 5(1)(e)).

## GitHub App

| Setting | Value |
|---|---|
| Repository: Metadata | read (implicit) |
| Repository: Pull requests | read and write (list PRs and commits, post the comment) |
| Repository: Checks | write (Check Runs, receive `check_run.rerequested`) |
| Repository: Issues | read (receive `issue_comment` for `/recheck`) |
| Organization: Members | read (private membership for the org-member exemption) |
| Account: Email addresses | read (verified emails at login, user token only) |
| Later: Merge queues | read (`merge_group.checks_requested`) |
| Events | `pull_request` (opened, reopened, synchronize, edited, ready_for_review, closed), `check_run` and `check_suite` (rerequested: single and "Re-run all checks"), `issue_comment` (created only; handled when it is on a PR, the sender is not a Bot, and a line is exactly `/recheck`; rate-limited per PR); `installation`, `installation_repositories` and `github_app_authorization` always arrive |
| Check name | `license/cla`, constant. Renaming breaks required-check rules. CLA Assistant posts a legacy status with the same context, and a same-named check and status must both pass: migrating repos must disable CLA Assistant first (or use a distinct check name for them) |
| Branch protection | Pin the required check to this app (ruleset `integration_id`) |

Gotchas worth remembering: the required check must have reported within 7 days to be selectable; passing conclusions are `success`, `skipped`, `neutral`; webhook response budget is 10 s so handlers only verify, dedupe and enqueue; installation tokens give 5,000 requests/hour (more on larger installs) so use Octokit throttling and honour `retry-after`.

## Security and privacy

- Webhook: HMAC-SHA256 over the **raw body** (`fastify-raw-body`), compared with `crypto.timingSafeEqual`; reject before parsing. Insert the `webhook_deliveries` row and enqueue the job in **one transaction**, and dedupe on `processed_at`, so a crash between the two cannot lose an event while GitHub's redelivery is deduped away. `X-GitHub-Delivery` is unsigned, so jobs re-fetch state instead of trusting payloads. A scheduled reconciliation sweep re-evaluates open PRs to cover missed deliveries. Two webhook secrets are accepted during rotation.
- Concurrency: one evaluation at a time per (repo, PR) without dropping newer work. The job reads the current head SHA at run time and re-checks it before writing the Check Run and comment, and reads signatures last, so a stale job cannot overwrite a newer result.
- Output encoding: names, logins and emails are user-controlled. CSV export prefixes cells starting with `=`, `+`, `-`, `@`, tab or CR to stop formula injection. PR comments and check summaries escape markdown, put names in code spans and neutralise `@` and `#`. Hostile-name tests (including a `toMatchFileSnapshot` CSV case) are mandatory.
- App private key, webhook secret and client secret come from the environment or a secret manager, never the repo. Trivy secret scan (pre-commit) and Semgrep `p/secrets` (pre-push, CI) guard this.
- Parameterised queries only (Kysely); zod validation at every boundary; strict CSP via helmet; no `dangerouslySetInnerHTML`.
- CLA text is rendered from markdown with an HTML-sanitising pipeline; stored hash is over the canonical source text.
- Identity is the numeric GitHub id. Logins and emails are snapshots.
- Data minimisation: identity and verified email only; request nothing else from signers.
- `@fastify/rate-limit` defaults to an in-memory store; a multi-instance deploy needs a shared store (Postgres or Redis). Set `trustProxy` correctly behind a load balancer or limits key on the proxy's IP.

## Operations

- **Private key rotation**: the App supports multiple private keys; generate the new key and deploy it before deleting the old one.
- **Backups**: signatures are legal evidence. Daily backups plus point-in-time recovery, with a periodically tested restore.
- **Poison jobs**: bounded pg-boss `retryLimit` and a dead-letter queue whose handler sets the Check Run to `failure` with a `/recheck` hint, so a check is never stuck `in_progress`.
- **GitHub rate budget**: cache installation tokens and org membership; Octokit throttling honours `retry-after`.

## Quality gates

Everything is strict by default: 100% coverage, zero lint findings, 100% type coverage, no unused code and ratcheted structural caps; a mutation-score floor joins when Stryker lands (deferred). Hooks give fast local feedback; **CI is authoritative** because hooks are bypassable.

### Tool evaluation

| Tool | Verdict | Where | Notes |
|---|---|---|---|
| Node 26 LTS + Corepack + Yarn 4 | Adopt, adjusted | everywhere | Corepack is **no longer bundled** since Node 25: `npm i -g corepack && corepack enable`. Pin via `.nvmrc`, `mise.toml`, `devEngines`, `packageManager`. Yarn 4.18 |
| mise (over fnm) | Adopt | dev | mise ignores `.nvmrc` unless configured, so commit `mise.toml`; fnm's `--corepack-enabled` is broken on Node 25+ |
| Biome | Adopt | hooks, CI | Formatter, import sorting, a11y, non-type-aware lint, cognitive complexity. Formats YAML too; its Markdown formatter is switched off (it rewrites table separators) |
| ESLint + typescript-eslint `strictTypeChecked` + sonarjs | Adopt | hooks, CI | `--max-warnings 0`, **no `--cache`** (stale for type-aware rules). Type-aware rules, sonarjs, security, complexity. `eslint-config-biome` is not used: it would switch off the type-aware `no-floating-promises` and `no-misused-promises` |
| eslint-plugin-security, no-unsanitized | Adopt | hooks, CI | Both work on ESLint 10; the security preset is escalated from warn to error. Plus Biome `noDangerouslySetInnerHtml` because no-unsanitized does not cover React |
| jsx-a11y | Skip | n/a | Plugin peers stop at ESLint 9; Biome a11y rules cover it |
| tsc -b + strict flags + type-coverage | Adopt | pre-push, CI | TypeScript pinned to 6.0.x (see Decisions) |
| Vitest + coverage-v8 | Adopt | hooks, CI | `thresholds: { 100: true }`, explicit `coverage.include` |
| Snapshots | Adopt | CI | `toMatchSnapshot`, inline, `toMatchFileSnapshot` (CSV export, API JSON); Playwright `toHaveScreenshot` |
| StrykerJS | Adopt (deferred: lands with its CI job) | CI | `core`, `vitest-runner`, `typescript-checker` 10.1+; `--incremental`, `thresholds.break`. Server/domain code only at first; the web project is outside the floor until a plan exists |
| Playwright | Adopt (deferred: lands with its CI job) | CI | Pinned container for deterministic visual baselines |
| ESLint `complexity: 10` + Biome cognitive complexity | Adopt | hooks, CI | Biome's rule is cognitive (not cyclomatic), default severity is `info`: set it to `error` |
| FTA | Adopt | pre-push, CI | `score_cap: 50`; pin exact version; exclude tests |
| Knip | Adopt | pre-push, CI | Run default and `--production --strict` |
| `check-code-caps.ts` | Adopt | pre-commit, pre-push, CI | Needs the TypeScript compiler API, hence TS 6 |
| Semgrep | Adopt (deferred: lands with its CI job) | pre-push if installed, CI | Five rulesets, `semgrep scan --error --metrics off` (never `semgrep ci`) |
| Trivy | Adopt (deferred: lands with its CI job) | pre-commit (secrets), pre-push, CI | v0.76.1 or later, Action pinned to full SHA. Two passes: vulnerabilities (HIGH/CRITICAL, prod deps in the gate, dev deps in a scheduled CI run) and an unfiltered secret + misconfig pass |
| memlab | Adopt (deferred: lands with its CI job) | CI nightly and release | Puppeteer based with its own Chromium; no leak-based exit code was found (unverified), so wrap it with `@memlab/api` and fail on leaks |
| Vitest `--logHeapUsage`, Node `--heap-prof` / `--cpu-prof` | Adopt, diagnostic only | on demand | Not gates. Used to investigate memlab or CI memory findings |
| Qodana (`qodana-js`) | Adopt, limited (deferred: lands with its CI job) | CI | Paid licence and token; fork PRs get no secrets, so make it a maintainer-side check |
| Lefthook | Adopt | hooks | v2 `jobs:` syntax. Hooks installed from root `postinstall` (Yarn never runs `prepare`) |
| GitNexus | Adopt as dev tooling | dev | Not a gate. PolyForm Noncommercial licence, and it edits CLAUDE.md |

### Hook pipeline

Order is cheap and deterministic first, expensive and flaky last, and each step only runs if the previous one passed.

| Stage | Scope | Target budget | Jobs, in order |
|---|---|---|---|
| `pre-commit` | staged files | 15 s | 1. `biome check --write --error-on-warnings` (restages fixes). Then in parallel: ESLint on staged files, `vitest related --run` (no coverage), `check-code-caps`, `trivy fs --scanners secret` |
| `commit-msg` | none | n/a | Not used |
| `pre-push` | whole repo | 3 min | 1. `biome ci --error-on-warnings` 2. `tsc -b` 3. in parallel: ESLint full, `type-coverage --strict --at-least 100`, Knip (both modes), FTA, `check-code-caps`, `trivy fs` (HIGH/CRITICAL plus secret/misconfig), Semgrep (skipped if not installed) 4. `CI=1 vitest run --coverage` at 100% |
| `post-merge`, `post-checkout`, `post-rewrite` | lockfile change | 1 min | `yarn install --immutable` when `yarn.lock` or `.yarnrc.yml` changed |

Today `lefthook.yml` has no Trivy or Semgrep job: they land with their CI jobs (a hook job must have a CI counterpart), and the `pre-push` hook calls the same `package.json` scripts as CI and `yarn gate` (`yarn lint:biome`, `yarn typecheck`, `yarn lint:eslint`, `yarn type-coverage`, `yarn knip`, `yarn fta`, `yarn caps`, `yarn coverage`). `pre-commit` runs staged-file variants of the binaries (`biome check --write`, `eslint`, `vitest related`) and shares only `yarn caps`. `skip: [merge, rebase]` is set on the slow `pre-commit` jobs only; on `pre-push` it would let `yarn gate` pass without running during a rebase. Budgets are targets, not measurements. `lefthook.yml` uses `piped: true` so a failed step stops the rest, with `group: parallel` for the independent static checks in step 3. Formatting runs before linting so lint sees the final text; types run before tests; coverage is last in the hook because it is the most expensive and meaningless if static gates fail. `CI=1` makes Vitest refuse to write new snapshots, so a push cannot go green with uncommitted snapshot files. Mutation, e2e, leak and Qodana runs are nondeterministic or slow and stay in CI.

Network-bound jobs (Trivy vulnerability DB, Semgrep registry rules) can be skipped offline with `LEFTHOOK_EXCLUDE=trivy,semgrep`; that is the only sanctioned hook exclusion, and CI still enforces them. Downloading Semgrep rules into a git-ignored `rules/` cache removes the registry dependency; do not commit them (see CLAUDE.md, Semgrep).

### CI (authoritative)

`.github/workflows/ci.yml`, every third-party Action pinned to a full commit SHA. `static`, `coverage` and `postgres` exist today; rows marked deferred land together with their tool. Job graph:

| Job | Needs | Runs |
|---|---|---|
| `static` | none | Explicit named steps running the same scripts as the `pre-push` hook minus the coverage step: Biome, `tsc -b`, ESLint, type-coverage per project, Knip (both modes), FTA, caps |
| `coverage` | none | `CI=1 vitest run --coverage` at 100%. Runs in parallel with `static` (both are required checks, so a skipped dependent job could not mask a failure). Later: upload `coverage/` for Qodana |
| `postgres` | none | `yarn test` with `DATABASE_URL` pointing at a PostgreSQL 18 service container (image pinned by tag and digest). The Vitest globalSetup creates a throw-away `cla_test_<hex>` database, the whole suite runs in it, and it is dropped afterwards. Not a required check; it exists to catch a difference between PGlite and a real server (the advisory-lock test only runs here) |
| `mutation` (deferred) | `static` | Stryker `--incremental`, `reports/stryker-incremental.json` restored from cache |
| `e2e` (deferred) | `static` | Playwright in the pinned container, including visual baselines |
| `semgrep`, `trivy` (deferred) | none | Full scans; mandatory, not skippable |
| `leaks` (deferred) | `coverage` | memlab; nightly and release only |
| `qodana` (deferred) | `coverage` | Maintainer-side; needs a token, skipped for fork PRs |

Branch protection on `main` requires `static` and `coverage` today (`postgres` is informative until the team decides to require it); `mutation`, `e2e`, `semgrep` and `trivy` become required once they are stable in CI (see CLAUDE.md, Repository protection). `yarn gate` is the local equivalent of `static` plus `coverage`. Dependabot (`.github/dependabot.yml`) keeps the SHA-pinned Actions and the npm dependencies current, with a one-week cooldown, grouped; TypeScript stays on 6.0.x.

## Decisions

| Decision | Why |
|---|---|
| TypeScript `~6.0.x`, not 7 | TS 7.0 (native Go) ships no classic compiler API; 7.1 adds a different one. typescript-eslint 8.72 peers `typescript <6.1`, and Stryker's typescript-checker, `type-coverage --strict` and `check-code-caps.ts` all need the classic JS API. Revisit when those tools support the new API |
| Kysely, not Drizzle | Drizzle 1.0 is still release-candidate (breaking changes pending); Kysely 0.29 is stable and pg-boss ships a Kysely adapter. The schema types are written by hand and a test compares them with the live catalog, so drift fails the build. The tests use a small own PGlite dialect (`kysely-pglite-dialect` sends every statement through the extended protocol, which rejects multi-statement migrations) |
| PGlite for the gated test suite, real Postgres 18 in CI | Fast and hook-friendly; CI re-runs the same suite against a Postgres service container |
| Check Runs, not commit statuses | Pinnable to the app, richer output, built-in Re-run button |
| `SameSite=Lax` session cookie | Contributors arrive from a cross-site link (the PR comment) and must be recognised on first navigation; compensated by CSRF token and `Origin` check. Deviates from RFC 10017's `Strict` suggestion |
| Code-based TanStack routing | No generated `routeTree.gen.ts` to exclude from every gate |
| `radix-ui` primitives, not shadcn copy-in | Copied components would count toward coverage, caps and FTA |
| React Compiler off in v0 | `@vitejs/plugin-react` 6 needs `@rolldown/plugin-babel` with a peer-range mismatch; lint rules for it are still enabled via `eslint-plugin-react-hooks` |
| No user tokens stored | Least privilege and liability; identity is read once at login |
| Self-hostable, multi-tenant by installation | One code path; SaaS is a deployment choice, not a fork |

## Development

Prerequisites: [mise](https://mise.jdx.dev) or any Node 26.13.0, Docker for the local database, [Trivy](https://trivy.dev) and [Semgrep](https://semgrep.dev) once their gates land.

```sh
mise install                                 # Node 26 first; or: fnm use (reads .nvmrc)
npm install -g corepack && corepack enable   # Node 26 no longer bundles Corepack
yarn install --immutable                     # also installs git hooks via postinstall (needs .git)
yarn gate                                    # local equivalent of CI's static + coverage jobs
```

Run the server against a local database:

```sh
docker compose up -d --wait postgres         # PostgreSQL 18 on 127.0.0.1:5432; creates roles cla_owner and cla_app
yarn db:migrate                              # applies migrations/ as the owner role
yarn dev                                     # node --watch src/server/main.ts as the cla_app role
curl -s localhost:3000/readyz                # {"status":"ready"}
```

Production style: `yarn build && yarn start` (`node dist/server/main.js`), and `node dist/server/migrate.js` for migrations. The defaults of `yarn dev` and `yarn db:migrate` are the well-known development passwords in `docker-compose.yml`, for a database on 127.0.0.1; override them with `DATABASE_URL` and `MIGRATION_DATABASE_URL`. `yarn test` needs no database (it uses in-memory PGlite). To run the same suite against a real server, point `DATABASE_URL` at one whose user may create databases; the run creates and drops its own `cla_test_<hex>` database and never touches the one the URL names:

```sh
DATABASE_URL=postgres://cla_owner:cla_owner_dev_only@127.0.0.1:5432/cla yarn test
```

Optional: `gitnexus analyze --skip-agents-md` builds a code knowledge graph (dev tooling only). A webhook tunnel (smee.io or similar) arrives with the GitHub App slice. Script names and their state (exists or deferred) are in [`CLAUDE.md`](CLAUDE.md).

### Configuration

The server reads only environment variables, validates them with zod at start-up, and exits with the NAMES of the invalid variables (never a value). An empty variable counts as unset. No dotenv file is read.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production`. Production requires an `https://` `PUBLIC_BASE_URL` |
| `HOST` | `127.0.0.1` | Interface to listen on. Containers set `0.0.0.0` |
| `PORT` | `3000` | TCP port, 0 to 65535 |
| `LOG_LEVEL` | `info` | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `DATABASE_URL` | none, required | `postgres://` connection string of the unprivileged runtime role `cla_app`. A secret: it is masked in logs and errors |
| `MIGRATION_DATABASE_URL` | falls back to `DATABASE_URL`, except in production where it is required | Owner connection used by `yarn db:migrate` only; the app never reads it. Tables created by the runtime role would be owned by it, and an owner can disable the immutability triggers |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>` | Origin the public reaches the app on (no path); required, as `https://`, in production |
| `TRUST_PROXY` | `false` | `true`, `false`, a hop count (`1`), or a comma separated list of IPs and CIDRs of trusted proxies. A typo is a start-up error, so it never silently trusts every proxy. Set it correctly behind a load balancer or every client looks like the proxy |
| `SESSION_SECRET` | none | At least 32 characters. Optional until sessions land |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | none | Placeholders: validated when set, required by the GitHub App slice |

What the foundation guarantees: every response carries a strict CSP and the other helmet headers (HSTS only for `https://` origins); every request gets an `x-request-id` (a well-formed incoming one is kept, otherwise a UUID) that appears in the log lines and in the error body; error bodies are `{ "error": { "code", "message", "requestId" } }` with the standard status text, so an exception message never reaches a client, and that holds for failures that never reach a route too (an invalid URL escape, an over-long parameter, garbage on the socket, oversized headers: Fastify's `frameworkErrors` and `clientErrorHandler` answer them with the same body, the request id and the same security headers); logs never hold headers, cookies, query strings, bodies or secrets. The HTTP server has explicit limits (`adapters/http/limits.ts`): 30 s for a silent socket and for a whole request, 10 s for the headers, a 65 s keep-alive, 1000 requests per connection and a 1 MiB body (a route that needs more, such as the webhook, raises it for itself). SIGINT and SIGTERM drain in-flight requests, but after 10 s (`shutdownTimeoutMs`) the open connections are dropped and the exit code is 1; a second signal does it at once. `GET /healthz` is liveness (touches nothing), `GET /readyz` is readiness (the database answers `select 1` within two seconds, else `503 {"status":"unavailable"}`). The client address is neither logged nor stored (network metadata stays off unless a configuration flag asks for it).

## Roadmap

1. **Scaffold**: toolchain, hooks and CI passing every gate at 100% (done), and the server foundation: configuration, logging, security headers, health routes, the schema and its migration runner, Postgres 18 in the tests (done). Stryker, Playwright, memlab, Semgrep, Trivy and Qodana follow with their CI jobs.
2. **Core**: GitHub App, webhook intake, PR evaluation, Check Run and comment.
3. **Signing**: login, CLA versions, consent flow, signature storage.
4. **Dashboard**: repos, signatures, CSV export, revoke, audit log.
5. **Hardening**: mutation floor ratchet, e2e + visual baselines, memlab nightly, Qodana.
6. **Corporate CLA** and merge queue support.

## Open questions

- Hosted SaaS, self-host only, or both?
- AGPLv3 "only" or "or later"? `AGPL-3.0-only` is assumed. GitNexus (dev tooling) is PolyForm Noncommercial, which matters if this becomes a commercial product.
- Is a Qodana licence and token available?
- Is corporate CLA required in the MVP?
- Hosting target and region (affects GDPR posture).

## License

[GNU Affero General Public License v3.0](LICENSE), SPDX identifier `AGPL-3.0-only`. `package.json` sets `"license": "AGPL-3.0-only"`. Dependencies must be AGPLv3-compatible (the same set as GPLv3: permissive licences such as MIT, Apache-2.0 and BSD are fine).

Why AGPL and not GPL: this is a network service. Under GPLv3, someone could run a modified copy as a hosted CLA service without publishing their changes; AGPLv3 section 13 closes that. The dashboard therefore links to the corresponding source. Running it unmodified for your own repositories, or self-hosting it inside your company, needs nothing beyond keeping that link.
