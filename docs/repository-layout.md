# Repository layout

Where things live in the repository. [`README.md`](../README.md) is the landing page and has the map of the documents; [`development.md`](development.md) says how to run the code.

Items marked (planned) do not exist yet.

```text
.
├── src/server/                  Fastify app; unit tests co-located as *.test.ts
│   ├── main.ts  migrate.ts      process entries (kept logic-free; covered by boot tests)
│   ├── boot.ts  app.ts          start-up and signals; the Fastify instance (buildApp); shutdown.ts and its test
│   ├── config/                  environment parsing (zod), Secret, TRUST_PROXY parsing
│   ├── adapters/db/             Kysely over node-postgres, hand-written schema types, migration runner and CLI,
│   │                            PGlite dialect and test helpers (test only, outside the build)
│   ├── adapters/http/           logger, request ids, security headers, error handling (also for failures that never
│   │                            reach a route), HTTP limits, health routes, trust-proxy conversion, the /api
│   │                            route-audit guard (audit-routes.ts)
│   ├── domain/evaluation/       the PR evaluation engine: pure functions over plain facts (actors, co-authors, unlinked
│   │                            identities, allowlist, signatures, commit listing, `evaluatePullRequest`), `index.ts` is
│   │                            its public surface
│   └── services/                audit.ts (appendAudit, the one public entry), audit-entry.ts (AuditEntry, validation)
├── src/shared/                  zod schemas shared by server and web (health, error body, GithubId, the audit
│                                vocabulary in audit.ts and the metadata schema in audit-metadata.ts, the PR evaluation
│                                codes, parts and stored-details schema `pr-evaluation-*.ts`)
├── src/web/                     (planned) React SPA
├── migrations/                  forward-only SQL, never edited after merge (001_initial.sql, 002_audit_metadata_allowlist.sql)
├── docker/postgres-init.sql     creates the unprivileged dev role cla_app (see docker-compose.yml)
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
