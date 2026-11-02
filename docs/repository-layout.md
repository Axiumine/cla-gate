# Repository layout

Where things live in the repository. [`README.md`](../README.md) is the landing page and has the map of the documents; [`development.md`](development.md) says how to run the code.

Items marked (planned) do not exist yet.

```text
.
├── src/server/                  Fastify app; unit tests co-located as *.test.ts
│   ├── main.ts  migrate.ts      process entries (kept logic-free; covered by boot tests)
│   ├── boot.ts  app.ts          start-up and signals; the Fastify instance (buildApp); shutdown.ts and its test
│   ├── boot-config.ts  boot-installations.ts  boot-reconcile.ts  boot-services.ts
│   │                            the parts of start-up: logging the configuration, binding the gate once the policies
│   │                            exist, reconciling installations, wiring the services
│   ├── config/                  environment parsing (zod), Secret, TRUST_PROXY parsing; github-app.ts and github-key.ts
│   │                            (App id and PEM, masked), allowed-accounts.ts (GITHUB_ALLOWED_ACCOUNT_IDS),
│   │                            auth-fields.ts and auth.ts (login variables, the login settings, `callbackUrl`, the
│   │                            start-up lines), migrate-config.ts (what `yarn db:migrate` needs; apart from env.ts
│   │                            to keep that file under the FTA score cap)
│   ├── adapters/db/             Kysely over node-postgres, hand-written schema types, migration runner and CLI,
│   │                            transaction and advisory-lock helpers, the branded installation row id,
│   │                            PGlite dialect and test helpers (test only, outside the build; the independent
│   │                            connections of the real-Postgres tests are in real-postgres/test-support.ts and
│   │                            re-exported by test-support.ts); the session store (sessions.ts with sessions-create,
│   │                            -delete, -model, -read, -row and -touch.ts; sessions-fixture/ is test only) and the
│   │                            user upsert (users.ts)
│   ├── adapters/github/         the Octokit adapter of the GitHub port (octokit-*.ts: client, requests, errors, auth),
│   │                            the App JWT (app-jwt.ts, app-auth.ts), the installation token provider
│   │                            (installation-tokens.ts, token-cache.ts, single-flight.ts), the self-check
│   │                            (app-identity.ts, start.ts), the rate limiter (rate-limiter.ts with lane, semaphore,
│   │                            point-bucket, wait-policy, rate-limit-reading.ts and rate-limit-log.ts), response
│   │                            schemas (schemas.ts), pagination; the login's calls to GitHub with the user's token
│   │                            (user-login*.ts: exchange, identity, addresses, revoke)
│   ├── adapters/http/           logger, request ids, security headers, error handling (also for failures that never
│   │                            reach a route), HTTP limits, health routes, trust-proxy conversion, the /api
│   │                            route-audit guard (audit-routes.ts); login and sessions: auth.ts (wiring), auth-hooks.ts
│   │                            (session lookup), auth-no-store.ts, auth-request.ts (`request.auth`, `requireAuth`),
│   │                            auth-routes.ts (session), auth-login.ts, auth-callback.ts, auth-logout.ts,
│   │                            session-cookie.ts, oauth-cookie.ts, oauth-attempt.ts; the request guards
│   │                            (request-guards.ts, csrf-token.ts, csrf-routes.ts); rate-limit.ts and
│   │                            trust-proxy-warning.ts; auth-fixture/, login-fixture/ and callback-fixture/ are test only
│   ├── domain/                  admission.ts (who is served, pure), eligibility.ts (when an installation or repository
│   │                            is evaluated), permissions.ts (the missing-permission check), session.ts (session
│   │                            lifetimes), return-to.ts (`safeReturnTo`), github-profile.ts (what is kept of a profile)
│   ├── domain/evaluation/       the PR evaluation engine: pure functions over plain facts (actors, co-authors, unlinked
│   │                            identities, allowlist, signatures, commit listing, `evaluatePullRequest`), `index.ts` is
│   │                            its public surface
│   └── services/                audit.ts (appendAudit, the one public entry), audit-entry.ts (AuditEntry, validation);
│                                ports/ (github.ts, installation-gate.ts, clock.ts, github-errors.ts); the stored
│                                installation gate and admission policies (installation-gate.ts, admission-policies.ts);
│                                login.ts (the login callback's transaction), revoke-user-sessions.ts (the job handler),
│                                ports/github-login.ts;
│                                the installation and repository state (installation-*.ts, repository-*.ts): store,
│                                queries, admission, sync and reconcile, transfer, operator view
├── src/shared/                  zod schemas shared by server and web (health, error body, GithubId, route constants in
│                                routes.ts, the session response in auth.ts, verified-email.ts, the audit
│                                vocabulary in audit.ts and the metadata schema in audit-metadata.ts, the PR evaluation
│                                codes, parts and stored-details schema `pr-evaluation-*.ts`)
├── src/web/                     (planned) React SPA
├── migrations/                  forward-only SQL, never edited after merge (001 to 004 and 006: initial schema, audit metadata allowlist, installation and repository state, account type Other, session verified emails)
├── docker/postgres-init.sql     creates the unprivileged dev role cla_app (see docker-compose.yml)
├── .env.example                 every environment variable with its default or an empty value (env-example.test.ts keeps it complete)
├── docker-compose.yml           local PostgreSQL 18, on a random free loopback port (POSTGRES_PORT, set by yarn db:up)
├── docs/ci-runners.md           CI runner policy: shared self-hosted runners, fork approval, ports, job rules
├── docs/development.md          status, setup and run, and the package.json scripts (exists or deferred)
├── docs/configuration.md        environment variables and what the server foundation guarantees
├── docs/quality-gates.md        thresholds, TypeScript setup, testing conventions, escape hatches
├── docs/toolchain.md            tool evaluation, hook pipeline, CI job graph
├── docs/architecture.md         stack, layering, how a PR is checked, architecture rules (webhooks, evaluation, auth, cookies, start-up)
├── docs/repository-layout.md    this file
├── docs/data-model.md           tables, immutability, erasure, database roles
├── docs/security.md             auth model, role matrix, security and privacy rules
├── docs/github-app.md           App permissions, events, check name, rules
├── docs/operations.md           key rotation, backups, poison jobs, rate budget
├── docs/decisions.md            why this project, decisions and their reasons, open questions
├── docs/tooling-gotchas.md      tool facts and traps, GitNexus, open tool verifications
├── docs/EPICS_STORIES.md        work queue index; the stories are in docs/epics/
├── scripts/eslint-layers.ts     the layering rules of the ESLint config, and their test
├── scripts/check-escape-hatches.ts  the escape-hatch justification gate (`yarn lint:hatches`); its modules, the ESLint
│                                block and the tests are in scripts/escape-hatches/
├── scripts/fetch-semgrep-rules.ts   downloads the five Semgrep rulesets into rules/ (`yarn semgrep:rules`); scripts/semgrep-rules/
│                                holds its logic and the tests of the Semgrep wiring
├── scripts/trivy-gate/          Trivy wiring: trivy.yaml, .trivyignore expiry, version pin, hook and CI job tests
├── scripts/mutation-gate/       tests of the Stryker configs and of the `mutation` job
├── scripts/e2e/  scripts/e2e-pin.test.ts   Playwright settings, container guards, spec rules; the version and digest pin test
├── scripts/leaks/               memlab wrapper logic (runner, outcome, exit guard, fixture server) and tests
├── scripts/qodana-gate/         tests of qodana.yaml, the token gate of the `qodana` job and the exclude-comment rule
├── scripts/ci-contract.test.ts  the CI contract test; scripts/ci-contract/ holds its parts (uses, workflow, required,
│                                package-scripts, dependabot, test-support)
├── scripts/docs/                doc-size.test.ts: README.md and CLAUDE.md stay under their byte ceilings
├── scripts/check-code-caps.ts   structure-cap ratchet, entry (runs natively on Node 26)
├── scripts/code-caps/           its modules (types, naming, nesting, collector, measure, files, baseline,
│                                report, cli) and tests; a port of the Python tool; README.md describes the tool
├── scripts/ci/                  CI helpers, run natively: free-port, postgres (start/stop the CI database container),
│                                check-runners (the workflow guard); logic and tests in lib/
├── scripts/dev/                 db.ts: local database on a random port (up, down, url, run); install-hooks.ts: the postinstall; logic and tests in lib/
├── .local/                      (git-ignored) the port that yarn db:up chose
├── types/                       ambient .d.ts for tools without types (eslint-plugin-no-unsanitized)
├── e2e/                         Playwright specs (smoke, canary), global-setup.ts, fixtures and visual baselines in __screenshots__/
├── tests/leaks/                 memlab scenarios, the control fixtures and the @memlab/api wrapper (run.ts)
├── LICENSE                      AGPL-3.0-only
├── rules/                       Semgrep rules cache, created by `yarn semgrep:rules` (git-ignored, never committed)
├── .github/workflows/ci.yml     jobs static, coverage, postgres, semgrep, trivy, mutation, e2e, leaks (self-hosted runners)
│                                and qodana (GitHub-hosted); .github/dependabot.yml
├── .code-caps-baseline.json
├── lefthook.yml  biome.json  eslint.config.mjs  fta.json  knip.json  vitest.config.ts
├── stryker.config.mjs  vitest.projects.ts  vitest.stryker.config.ts  vitest.stryker-scripts.config.ts
├── playwright.config.ts  qodana.yaml  trivy.yaml  .semgrepignore  .trivyignore
├── vite.config.ts  Dockerfile                                                 (planned)
├── .nvmrc  mise.toml  .yarnrc.yml  package.json  yarn.lock  .gitattributes
├── tsconfig.json                solution-style root (files: [])
├── tsconfig.base.json  tsconfig.server.json  tsconfig.server.test.json
├── tsconfig.scripts.json  tsconfig.e2e.json  tsconfig.node.json
├── README.md  CLAUDE.md  CONTRIBUTING.md  CHANGELOG.md
```

The server compiles with `tsconfig.server.json` (composite, emits `dist/`, excludes tests, test helpers and the PGlite adapter). `tsconfig.server.test.json` type-checks the same sources plus every test, and ESLint and type-coverage run over both.
