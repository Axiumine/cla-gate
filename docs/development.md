# Development: status and commands

What exists today and how to run it: status, the setup walk-through and every `package.json` script. [`README.md`](../README.md) explains the product and has the quick start; [`CLAUDE.md`](../CLAUDE.md) is the short operating contract; the environment variables are in [`configuration.md`](configuration.md).

## Status

**Status: server foundation and GitHub App core built, product not built.** The toolchain is in place and green on all the code that exists: the caps tool (`scripts/check-code-caps.ts` plus `scripts/code-caps/`) and the server foundation in `src/server` and `src/shared` (environment config, pino logging, helmet headers, request ids, error handler, `/healthz` and `/readyz`, Kysely over node-postgres, the forward-only migration runner, `migrations/001_initial.sql` with the whole MVP schema and `migrations/002_audit_metadata_allowlist.sql`, `migrations/003_installation_repository_state.sql` and `migrations/004_installation_account_type_other.sql`, the audit writer in `src/server/services` with its route guard, a PGlite test database that can be swapped for real Postgres) and, from epic E05, the GitHub App core: App configuration and key rotation, the App JWT and identity check, the installation token provider, the GitHub client port with its Octokit adapter (`octokit`) and in-memory fake, the rate limiter, the installation and repository tables and store, the instance admission policy, and the installation sync with repository rename, transfer and removal. Tooling: `package.json`, Yarn 4, TypeScript, Biome, ESLint, Vitest at 100% coverage, type-coverage, Knip, FTA, the caps ratchet, Lefthook hooks and `.github/workflows/ci.yml` (required jobs `static` and `coverage`, plus the informative `postgres`, `semgrep`, `trivy`, `mutation`, `e2e`, `leaks` and `qodana`). There is no webhook receiver, job queue, session, signing route or `src/web` yet, and no placeholder routes, jobs or UI for them; the `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET` and `SESSION_SECRET` variables are validated placeholders (`config/env-fields.ts`) that later slices make required. The App itself is configured (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_ALLOWED_ACCOUNT_IDS`; see [configuration](configuration.md)) and is required in production. Every gate tool is wired with its CI job: Semgrep, Trivy, StrykerJS (two scopes), Playwright with visual baselines, memlab, the real-Postgres run and Qodana. They are informative until the promotion stories E20-S10 to E20-S15 make them required checks; `leaks` and `qodana` never become required. Qodana has never run, because the licence and the secret `QODANA_TOKEN` do not exist yet: its job ends green with a notice until they do. Version numbers, flags and config keys were verified against live sources on 2026-11-01; re-check with `yarn npm info <pkg> version` before pinning, and update the owning document (see the table in `CLAUDE.md`) when a decision changes.

## Setup and run

Prerequisites: [mise](https://mise.jdx.dev) or any Node 26.13.0, Docker for the local database, [Trivy](https://trivy.dev) (the hooks run it; `mise install` installs the pinned version) and [Semgrep](https://semgrep.dev) (installed by `mise` through pipx at the version pinned in `mise.toml`; the pre-push job skips itself when the binary is absent). Offline, `LEFTHOOK_EXCLUDE=trivy,semgrep` is the one sanctioned hook exclusion; CI still enforces both.

```sh
mise install                                 # Node 26 first; or: fnm use (reads .nvmrc)
npm install -g corepack && corepack enable   # Node 26 no longer bundles Corepack
yarn install --immutable                     # also installs git hooks via postinstall (skipped when CI is set or there is no .git)
yarn gate                                    # local equivalent of CI's static + coverage jobs
```

Run the server against a local database:

```sh
yarn db:up                                   # PostgreSQL 18 on 127.0.0.1 at a random free port (32769-60999); creates roles cla_owner and cla_app
yarn db:migrate                              # applies migrations/ as the owner role
yarn dev                                     # node --watch src/server/main.ts as the cla_app role; prints its address, a random free port above 32768
curl -s http://127.0.0.1:<port>/readyz       # {"status":"ready"}, with the port that yarn dev printed (an explicit PORT wins)
yarn db:down                                 # stops it; add --volumes to delete the data
```

`yarn db:up` picks the port, writes it to the git-ignored `.local/db.json`, and reuses it while the stack runs, so `docker-compose.yml` has no default port and fails with a hint if you run `docker compose` by hand. `yarn dev` and `yarn db:migrate` read that port and use the well-known development passwords in `docker-compose.yml` (a database on 127.0.0.1 only); a `DATABASE_URL` or `MIGRATION_DATABASE_URL` that is already set wins. `yarn db:url [app|owner]` prints the connection string.

Production style: `yarn build && yarn start` (`node dist/server/main.js`), and `node dist/server/migrate.js` for migrations. `yarn test` needs no database (it uses in-memory PGlite). To run the same suite against a real server, point `DATABASE_URL` at one whose user may create databases; the run creates and drops its own `cla_test_<hex>` database and never touches the one the URL names:

```sh
DATABASE_URL="$(yarn db:url owner)" yarn test
```

The CI `postgres` job does the same with a throw-away container (`yarn ci:postgres start`, then `yarn test`, then `yarn ci:postgres stop`). It also sets `REQUIRE_REAL_POSTGRES=1` (a real-Postgres-only test then fails on PGlite instead of skipping) and `CLA_ROLE_TESTS=1` (the tests that create or alter cluster-wide roles; never set it against a server that others use), and the suite checks that `server_version_num` is at least 180000 and below 190000. A random port: `yarn ci:port`. Check the workflows against the runner policy: `yarn ci:runners`.

Browser tests: `yarn e2e` needs `yarn build` first and a migrated database in `DATABASE_URL`, for example `node scripts/dev/db.ts run app -- yarn e2e:update` (baselines are only ever written inside the pinned container; see [`quality-gates.md`](quality-gates.md), Testing).

Optional: `gitnexus analyze --skip-agents-md` builds a code knowledge graph (dev tooling only). A webhook tunnel (smee.io or similar) arrives with the GitHub App slice. Script names and their state (exists or deferred) are in the Commands table below. The work queue (epics, stories and their acceptance criteria) is in [`EPICS_STORIES.md`](EPICS_STORIES.md).

## Commands (`package.json` scripts)

The `State` column says whether the script exists now or is deferred until its tool lands. A deferred script is a contract; do not add a placeholder.

| Script | Runs | State |
|---|---|---|
| `yarn dev` | `node --watch src/server/main.ts` as the `cla_app` role of `docker-compose.yml` on the port `yarn db:up` chose (via `scripts/dev/db.ts run`); later also the Vite dev server, which proxies `/api` | exists (server only) |
| `yarn build` | server `tsc -b` into `dist/`; later also the SPA build | exists (server only) |
| `yarn start` | `node dist/server/main.js` | exists |
| `yarn typecheck` | `tsc -b` | exists |
| `yarn type-coverage` | `type-coverage --strict --at-least 100` once per tsconfig project (`-p`), including e2e and node-config projects | exists (server, server.test, scripts and node-config projects) |
| `yarn lint` | `yarn lint:biome`, `yarn lint:eslint`, then `yarn lint:hatches` | exists |
| `yarn lint:biome` | `biome ci --error-on-warnings .` | exists |
| `yarn lint:eslint` | `eslint . --max-warnings 0 --no-warn-ignored` | exists |
| `yarn lint:hatches` | `node scripts/check-escape-hatches.ts`: every `any`, `as` (other than `as const`), coverage-ignore and `type-coverage` ignore comment and every `//noinspection` needs a written reason (see [`quality-gates.md`](quality-gates.md), Escape hatches) | exists |
| `yarn format` | `biome check --write .` | exists |
| `yarn test` | `vitest run` (no coverage). In-memory PGlite by default; with `DATABASE_URL` set it runs the same suite on a real Postgres in a throw-away `cla_test_<hex>` database | exists |
| `yarn coverage` | `CI=1 vitest run --coverage`, thresholds 100% (`CI=1` makes new snapshots fail) | exists |
| `yarn mutate` | `stryker run --incremental`, server and shared code (`break` 90). Add `--force` after a test, snapshot, environment or dependency change: incremental mode does not re-run static (module-level constant) mutants, and a stale run shows bogus survivors | exists |
| `yarn mutate:scripts` | `STRYKER_SCOPE=scripts stryker run --incremental`: the same gate for the caps tool (`scripts/check-code-caps.ts`, `scripts/code-caps/`), report in `reports/mutation/scripts/index.html` | exists |
| `yarn e2e` | `playwright test` against the built server on a migrated database. `yarn e2e:update` regenerates baselines **inside the digest-pinned Playwright container only**; the host guard (`Refusing to write visual baselines outside the pinned container`) and the skip of `.visual.spec.ts` files on the host keep it that way. `yarn ci:e2e` is the CI helper that starts that container | exists |
| `yarn knip` | `knip` and `knip --production --strict` | exists |
| `yarn fta` | `fta . --config-path fta.json` | exists |
| `yarn caps` | `node scripts/check-code-caps.ts` | exists |
| `yarn ci:runners`, `ci:postgres`, `ci:port`, `db:up`, `db:url`, `db:down` | Runner-policy guard for `.github/workflows/` (in `static` and `pre-push`); CI database container `start`/`stop`; a random free loopback port (32769-60999); the dev database on such a port. Policy and rules: `docs/ci-runners.md` | exists |
| `yarn semgrep` | `semgrep scan --config p/typescript --config p/javascript --config p/react --config p/nodejsscan --config p/secrets --error --metrics off --disable-version-check` | exists |
| `yarn semgrep:rules`, `yarn semgrep:offline` | `node scripts/fetch-semgrep-rules.ts` downloads the five rulesets to the git-ignored `rules/`; `semgrep scan --config rules/ --error --metrics off --disable-version-check` scans with that copy, offline | exists |
| `yarn trivy` | Two passes: `trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .` and `trivy fs --scanners secret,misconfig --exit-code 1 .` (no severity filter) | exists |
| `yarn trivy:dev`, `yarn trivy:secrets` | The first pass plus `--include-dev-deps` (nightly CI run only); `trivy fs --scanners secret --exit-code 1 .` (pre-commit, needs no vulnerability database) | exists |
| `yarn leaks`, `yarn leaks:control` | memlab scenarios through the `@memlab/api` wrapper in `tests/leaks/run.ts` (exit 0 clean, 1 a leak, 2 an error); the control proves the wrapper fails on a deliberate leak, passes a clean page and reports a broken one. The CI `leaks` job runs on the nightly schedule, a manual run and `v*` tags only | exists |
| `yarn db:migrate` | Apply `migrations/` with `src/server/migrate.ts` as the owner role (`MIGRATION_DATABASE_URL`, development default from `docker-compose.yml` on the port `yarn db:up` chose). Production runs `node dist/server/migrate.js` | exists |
| `yarn gate` | `lefthook run pre-push --all-files`: the CI `static` and `coverage` jobs. CI additionally runs `postgres`, `semgrep`, `trivy`, `mutation`, `e2e`, `leaks` and `qodana` | exists |
| `postinstall` | `node scripts/dev/install-hooks.ts`: `lefthook install` (Yarn Berry never runs `prepare`), skipped when `CI` is set or there is no `.git` | exists |

Variables the gates read (the server never reads them; the server's own are in [`configuration.md`](configuration.md)):

| Variable | Read by | Meaning |
|---|---|---|
| `STRYKER_SCOPE` | `stryker.config.mjs` | Unset or `server`: server and shared code. `scripts`: the caps tool. Anything else throws, so a typo cannot run the wrong scope and pass |
| `REQUIRE_REAL_POSTGRES` | `src/server/adapters/db/test-support.ts` | `1` (only that value) makes a real-Postgres-only test fail instead of skip on PGlite. Set by the `postgres` job only |
| `CLA_ROLE_TESTS` | the same | `1` lets the tests that create or alter cluster-wide roles run on a real server. Set by the `postgres` job only |
| `E2E_CONTAINER` | `e2e/global-setup.ts` | `1` inside the pinned Playwright container (set by `yarn e2e:update` and `yarn ci:e2e`); without it a baseline write is refused |
| `LEFTHOOK_EXCLUDE` | Lefthook | `trivy,semgrep` offline: the one sanctioned hook exclusion |

Run a tool binary by hand with `yarn <bin> ...` only when no script has the same name: `yarn type-coverage --flags` appends the flags to the script's last command, so use `node_modules/.bin/type-coverage` for ad hoc runs.
