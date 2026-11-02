# Development: status and commands

What exists today and how to run it: status, the setup walk-through and every `package.json` script. [`README.md`](../README.md) explains the product and has the quick start; [`CLAUDE.md`](../CLAUDE.md) is the short operating contract; the environment variables are in [`configuration.md`](configuration.md).

## Status

**Status: server foundation built, product not built.** The toolchain is in place and green on all the code that exists: the caps tool (`scripts/check-code-caps.ts` plus `scripts/code-caps/`) and the server foundation in `src/server` and `src/shared` (environment config, pino logging, helmet headers, request ids, error handler, `/healthz` and `/readyz`, Kysely over node-postgres, the forward-only migration runner, `migrations/001_initial.sql` with the whole MVP schema, a PGlite test database that can be swapped for real Postgres). Tooling: `package.json`, Yarn 4, TypeScript, Biome, ESLint, Vitest at 100% coverage, type-coverage, Knip, FTA, the caps ratchet, Lefthook hooks and `.github/workflows/ci.yml` (required jobs `static` and `coverage`, plus the informative `postgres`). There is no GitHub App, webhook, job queue, session, signing route or `src/web` yet, and no placeholder routes, jobs or UI for them; the `GITHUB_*` and `SESSION_SECRET` variables are validated placeholders (`config/env-fields.ts`) that later slices make required. Gates for tools that are not wired (Stryker, Playwright, memlab, Semgrep, Trivy, Qodana) are deferred and marked in the Commands table below; they join with their CI jobs. Version numbers, flags and config keys were verified against live sources on 2026-11-01; re-check with `yarn npm info <pkg> version` before pinning, and update the owning document (see the table in `CLAUDE.md`) when a decision changes.

## Setup and run

Prerequisites: [mise](https://mise.jdx.dev) or any Node 26.13.0, Docker for the local database, [Trivy](https://trivy.dev) and [Semgrep](https://semgrep.dev) once their gates land.

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

The CI `postgres` job does the same with a throw-away container (`yarn ci:postgres start`, then `yarn test`, then `yarn ci:postgres stop`). A random port: `yarn ci:port`. Check the workflows against the runner policy: `yarn ci:runners`.

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
| `yarn lint` | `yarn lint:biome` then `yarn lint:eslint` | exists |
| `yarn lint:biome` | `biome ci --error-on-warnings .` | exists |
| `yarn lint:eslint` | `eslint . --max-warnings 0 --no-warn-ignored` | exists |
| `yarn format` | `biome check --write .` | exists |
| `yarn test` | `vitest run` (no coverage). In-memory PGlite by default; with `DATABASE_URL` set it runs the same suite on a real Postgres in a throw-away `cla_test_<hex>` database | exists |
| `yarn coverage` | `CI=1 vitest run --coverage`, thresholds 100% (`CI=1` makes new snapshots fail) | exists |
| `yarn mutate` | `stryker run --incremental` | deferred (Stryker PR) |
| `yarn e2e` | Playwright; `yarn e2e:update` regenerates baselines **inside the pinned container only** | deferred (Playwright PR) |
| `yarn knip` | `knip` and `knip --production --strict` | exists |
| `yarn fta` | `fta . --config-path fta.json` | exists |
| `yarn caps` | `node scripts/check-code-caps.ts` | exists |
| `yarn ci:runners`, `ci:postgres`, `ci:port`, `db:up`, `db:url`, `db:down` | Runner-policy guard for `.github/workflows/` (in `static` and `pre-push`); CI database container `start`/`stop`; a random free loopback port (32769-60999); the dev database on such a port. Policy and rules: `docs/ci-runners.md` | exists |
| `yarn semgrep` | `semgrep scan --config p/typescript --config p/javascript --config p/react --config p/nodejsscan --config p/secrets --error --metrics off --disable-version-check` | deferred (security PR) |
| `yarn trivy` | Two passes: `trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .` (add `--include-dev-deps` in the scheduled CI run) and `trivy fs --scanners secret,misconfig --exit-code 1 .` (no severity filter) | deferred (security PR) |
| `yarn leaks` | memlab scenarios via `@memlab/api` wrapper | deferred (memlab PR) |
| `yarn db:migrate` | Apply `migrations/` with `src/server/migrate.ts` as the owner role (`MIGRATION_DATABASE_URL`, development default from `docker-compose.yml` on the port `yarn db:up` chose). Production runs `node dist/server/migrate.js` | exists |
| `yarn gate` | `lefthook run pre-push --all-files`: the CI `static` and `coverage` jobs. CI additionally runs mutation, e2e, leaks and Qodana once they exist | exists |
| `postinstall` | `node scripts/dev/install-hooks.ts`: `lefthook install` (Yarn Berry never runs `prepare`), skipped when `CI` is set or there is no `.git` | exists |

Run a tool binary by hand with `yarn <bin> ...` only when no script has the same name: `yarn type-coverage --flags` appends the flags to the script's last command, so use `node_modules/.bin/type-coverage` for ad hoc runs.
