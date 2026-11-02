# Repository layout

Where things live in the repository. [`README.md`](../README.md) is the landing page and has the map of the documents; [`development.md`](development.md) says how to run the code.

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
│   ├── domain/evaluation/       the PR evaluation engine: pure functions over plain facts (actors, co-authors, unlinked
│   │                            identities, allowlist, signatures, commit listing, `evaluatePullRequest`), `index.ts` is
│   │                            its public surface
│   └── services/                (planned) orchestration
├── src/shared/                  zod schemas shared by server and web (health, error body, the PR evaluation codes,
│                                parts and stored-details schema `pr-evaluation-*.ts`)
├── src/web/                     (planned) React SPA
├── migrations/                  forward-only SQL, never edited after merge (001_initial.sql)
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
├── scripts/docs/                doc-size.test.ts: README.md and CLAUDE.md stay under their byte ceilings
├── scripts/check-code-caps.ts   structure-cap ratchet, entry (runs natively on Node 26)
├── scripts/code-caps/           its modules (types, naming, nesting, collector, measure, files, baseline,
│                                report, cli) and tests; a port of the Python tool; README.md describes the tool
├── scripts/ci/                  CI helpers, run natively: free-port, postgres (start/stop the CI database container),
│                                check-runners (the workflow guard); logic and tests in lib/
├── scripts/dev/                 db.ts: local database on a random port (up, down, url, run); install-hooks.ts: the postinstall; logic and tests in lib/
├── .local/                      (git-ignored) the port that yarn db:up chose
├── types/                       ambient .d.ts for tools without types (eslint-plugin-no-unsanitized)
├── e2e/                         (planned) Playwright specs and visual baselines
├── tests/leaks/                 (planned) memlab scenarios and the @memlab/api wrapper
├── LICENSE                      AGPL-3.0-only
├── rules/                       (planned) Semgrep rules cache (git-ignored, never committed)
├── .github/workflows/ci.yml     jobs static, coverage and postgres, all on self-hosted runners; .github/dependabot.yml
├── .code-caps-baseline.json
├── lefthook.yml  biome.json  eslint.config.mjs  fta.json  knip.json  vitest.config.ts
├── stryker.config.mjs  playwright.config.ts  qodana.yaml  vite.config.ts      (planned)
├── .semgrepignore  .trivyignore  Dockerfile                                   (planned)
├── .nvmrc  mise.toml  .yarnrc.yml  package.json  yarn.lock  .gitattributes
├── tsconfig.json                solution-style root (files: [])
├── tsconfig.base.json  tsconfig.server.json  tsconfig.server.test.json
├── tsconfig.scripts.json  tsconfig.node.json
├── README.md  CLAUDE.md  CONTRIBUTING.md  CHANGELOG.md
```

The server compiles with `tsconfig.server.json` (composite, emits `dist/`, excludes tests, test helpers and the PGlite adapter). `tsconfig.server.test.json` type-checks the same sources plus every test, and ESLint and type-coverage run over both.
