# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. [`README.md`](README.md) explains the product and architecture; this file is the operating contract: commands, hard rules, thresholds and tooling gotchas.

## Project

CLA Platform: a GitHub App plus React dashboard that enforces Contributor License Agreements on pull requests. Contributors sign once with GitHub login; every PR gets a `license/cla` Check Run. Stack: Node 26 LTS, Yarn 4, TypeScript 6.0.x, React 19 + Vite 8, Fastify 5, PostgreSQL 18, Kysely, pg-boss.

**Licence: AGPL-3.0-only** (`LICENSE`; `package.json` `"license": "AGPL-3.0-only"`; every source file carries `// SPDX-License-Identifier: AGPL-3.0-only`). Every dependency must be AGPLv3-compatible (the same set as GPLv3: MIT, BSD, ISC, Apache-2.0, LGPL-3.0 and GPL-3.0 are fine; GPL-2.0-only is not); do not add incompatible licences (for example SSPL, BUSL, PolyForm, or Apache-1.x), and do not copy code from incompatible sources. AGPL section 13: the web UI must offer every network user the corresponding source (a visible link in the dashboard footer to the exact repository and commit).

**Status: planning, app not scaffolded.** `README.md`, `CLAUDE.md`, `LICENSE` and the caps tool (`scripts/check-code-caps.ts` plus `scripts/code-caps/`, tests included) exist. There is no `package.json` yet, so the caps tool and its tests have been verified only in a throwaway harness outside the repo. Until the scaffold lands, "commands" below are a contract for the scripts to create. Versions were verified 2026-11-01; re-check with `yarn npm info <pkg> version` before pinning, and update this file when a decision changes.

## Commands (contract for `package.json` scripts)

| Script | Runs |
|---|---|
| `yarn dev` | Vite dev server plus Fastify with reload; Vite proxies `/api` |
| `yarn build` | SPA build plus server `tsc -b` |
| `yarn typecheck` | `tsc -b` |
| `yarn type-coverage` | `type-coverage --strict --at-least 100` once per tsconfig project (`-p`), including e2e and node-config projects |
| `yarn lint` | `biome ci --error-on-warnings .` then `eslint . --max-warnings 0 --no-warn-ignored` |
| `yarn format` | `biome check --write .` |
| `yarn test` | `vitest run` (no coverage) |
| `yarn coverage` | `CI=1 vitest run --coverage`, thresholds 100% (`CI=1` makes new snapshots fail) |
| `yarn mutate` | `stryker run --incremental` |
| `yarn e2e` | Playwright; `yarn e2e:update` regenerates baselines **inside the pinned container only** |
| `yarn knip` | `knip` and `knip --production --strict` |
| `yarn fta` | `fta` with `fta.json` |
| `yarn caps` | `node scripts/check-code-caps.ts` |
| `yarn semgrep` | `semgrep scan --config p/typescript --config p/javascript --config p/react --config p/nodejsscan --config p/secrets --error --metrics off --disable-version-check` |
| `yarn trivy` | Two passes: `trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .` (add `--include-dev-deps` in the scheduled CI run) and `trivy fs --scanners secret,misconfig --exit-code 1 .` (no severity filter) |
| `yarn leaks` | memlab scenarios via `@memlab/api` wrapper |
| `yarn db:migrate` | Apply `migrations/` |
| `yarn gate` | `lefthook run pre-push --all-files`: the CI `static` and `coverage` jobs. CI additionally runs mutation, e2e, leaks and Qodana |

## Hard rules (non-negotiable)

1. **Never bypass a gate.** No `--no-verify`, no `LEFTHOOK=0`, no lowering a threshold, no growing `.code-caps-baseline.json`, no excluding files from coverage to make it pass. Fix the code. The baseline may only shrink. Sanctioned exceptions, and only these: `LEFTHOOK_EXCLUDE=trivy,semgrep` when offline (CI still enforces them), and the fixed coverage exclusion list under Thresholds.
2. **100% means real.** Every behaviour change ships with tests that assert behaviour. Tests that merely execute lines will die in mutation testing.
3. **No escape hatches without a reason.** `any`, `as` assertions (`type-coverage --strict` penalises them), `@ts-expect-error`, `eslint-disable`, `biome-ignore`, `v8 ignore` are last resorts, each with a written justification on the same line. `reportUnusedDisableDirectives` stays on. Prefer zod parsing and type guards over assertions. Any `v8 ignore` needs `-- @preserve` or the bundler strips it.
4. **Identity is the numeric GitHub id.** Never key signatures, allowlists or approvals on login or email. Logins and emails are display snapshots.
5. **The signature core, CLA versions and audit rows are immutable.** Enforced by DB triggers that block UPDATE (beyond `revoked_*`), DELETE and TRUNCATE; the runtime DB role must not own the tables. Personal data (name, email, login) lives only in the erasable `signer_pii` table, never in the core or in `audit_log`. Erasure goes through one audited SQL function. Migrations must not weaken any of this. Revocation is prospective only.
6. **Migrations are forward-only.** Never edit a merged migration; add a new one.
7. **No secrets in the repo or logs.** App private key, webhook secret, client secret, session secret live in env or a secret manager. Never log tokens, emails or request bodies. Do not store GitHub user tokens.
8. **New dependency needs justification** (Knip, Trivy, supply-chain cost) **and an AGPLv3-compatible licence.** Yarn's `npmMinimalAgeGate` defaults to 1 day; do not disable it.
9. **Commit or push only when asked.** Do not rewrite history on shared branches.
10. **Keep this file true.** If a decision changes, update `CLAUDE.md` and `README.md` in the same change.

## Thresholds

| Gate | Threshold |
|---|---|
| Vitest coverage (v8) | `thresholds: { 100: true }` (lines, branches, functions, statements); `coverage.include: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts']` so unloaded files count. **Fixed exclusion list (the only one):** `**/*.test.{ts,tsx}`, `**/*.d.ts`, test setup files, MSW handlers, `e2e/`, `tests/leaks/`, root tooling config files. Application entrypoints stay in scope: keep them logic-free and cover them with a boot test (start the app on PGlite, hit a health route) |
| type-coverage | `--strict --at-least 100`, per tsconfig project |
| ESLint | `--max-warnings 0`; `complexity: ['error', 10]`; `max-lines` 500, `max-lines-per-function` 50, `max-params` 4, `max-depth` 4 as **errors**, with counting options (`skipBlankLines`, `skipComments`) set to match the caps script so both agree. There is no ESLint class-size rule and no ratchet: the script stays the gate |
| Biome | `complexity/noExcessiveCognitiveComplexity` level `error`, `maxAllowedComplexity: 10` (it is cognitive, not cyclomatic, and `info` by default); `--error-on-warnings` everywhere; disable sonarjs's duplicate `cognitive-complexity` |
| check-code-caps | file 500, function 50, class 300, params 4, nesting 4; ratchet vs `.code-caps-baseline.json`; fails on any new or **grown** violation. Greenfield baseline is empty. **Tests obey the same caps** (the user's convention from the Python tool): write flat `test()` / `test.each()` tables, no `describe` wrapper around a whole file, at most 4 parameters or fixtures per test, split files by topic. Details under "Code caps tool" |
| FTA | `score_cap: 50`; the run fails when score is above 50 (per source code; the docs say below 50 is OK, so exactly 50 is ambiguous), which rules out the "could be better" band too. Exclude tests via `exclude_filenames` |
| Stryker | `thresholds.break: 90` initially, raise as the score allows, never lower. `--incremental`. Packages: `@stryker-mutator/core`, `vitest-runner`, `typescript-checker` (all 10.1+), `checkers: ['typescript']` with `tsconfigFile` pointing at the server project. Scope: server and domain code; the web project is outside the floor until a plan exists |
| Knip | zero issues in both modes |
| Trivy | HIGH and CRITICAL vulnerabilities fail; any secret or misconfiguration fails; `--exit-code 1` must be explicit (default is 0) |
| Semgrep | any finding fails (`--error`) |

## TypeScript

- Single compiler: `typescript` pinned to `~6.0.x`. **Do not upgrade to 7.x.** TS 7 ships no compiler API (7.1 adds a different one) and typescript-eslint 8.72 peers `typescript <6.1`. Stryker's typescript-checker, `type-coverage --strict` and `scripts/check-code-caps.ts` need the classic API. Revisit when typescript-eslint supports TS 7.1.
- Required compiler options: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Library code uses `allowImportingTsExtensions` or `rewriteRelativeImportExtensions` as appropriate.
- Project layout: solution-style root `tsconfig.json` (`files: []`) referencing app (bundler resolution, DOM, `noEmit`), server (`nodenext`, `composite`, explicit `rootDir` and `outDir`, emit excludes `**/*.test.ts`), scripts (`nodenext`, `noEmit`), e2e (Playwright specs and `tests/leaks`, `noEmit`), and node-config (`vite.config.ts`, `playwright.config.ts`, Stryker/ESLint config, `noEmit`). Unit tests are co-located and typechecked in their owning project. Every project gets the strict flags, type-coverage and ESLint `projectService` coverage. `package.json` has `"type": "module"`. TS 6 defaults: `strict: true`, `types: []` (list `node` and `vite/client` explicitly), default `rootDir` is the tsconfig dir (set it).
- `tsc -b` is whole-project; gitignore `*.tsbuildinfo` and cache it in CI.
- Scripts run natively: `node scripts/foo.ts`. Native type stripping is stable in Node 26 but accepts **erasable syntax only**: no `enum`, no runtime `namespace`, no constructor parameter properties, `import type` for types, explicit `.ts` extensions, and Node ignores `tsconfig.json` (use `#subpath` imports, not `paths`). `typescript` is loaded from `node_modules` as plain JS, which is fine; it must be the 6.x package, and only the default import (`import ts from 'typescript'`) is verified, so do not use named imports until tested.

## Architecture rules

- `src/shared` imports neither `src/server` nor `src/web`. `src/web` never imports `src/server` and vice versa. Enforced by ESLint `no-restricted-imports` overrides and Knip.
- Decision logic (PR evaluation, signature coverage, allowlist matching) lives in `src/server/domain` as pure functions with no I/O. I/O only in `src/server/adapters`.
- Validate every external input (HTTP, webhook payloads, GitHub API responses, env) with zod at the boundary. Share schemas through `src/shared`.
- Webhook handler order: verify HMAC on the **raw body** with `crypto.timingSafeEqual`; in **one transaction** insert the `webhook_deliveries` row and enqueue the job; dedupe on `processed_at`; return 2xx. No GitHub API calls in the request path (10 s limit). Accept two webhook secrets during rotation. Jobs re-fetch PR state and never trust the payload.
- Concurrency: serialise evaluation per (repo, PR) **without dropping newer sends**. pg-boss `short` and `exclusive` policies drop a second send; pick a policy that queues per key (check the pg-boss policy docs; candidates are `singleton` or `key_strict_fifo`). The job reads the current head SHA at run time, re-checks it before writing the Check Run and comment, and reads signatures last. PGlite is single-connection, so concurrency tests run against real Postgres.
- `issue_comment` handling: `created` only, issue must be a PR, sender must not be a Bot, a line must be exactly `/recheck`, rate-limited per PR. Also handle `check_run` and `check_suite` `rerequested`, and `pull_request` `closed` (prune pending work). A scheduled sweep re-evaluates open PRs to catch missed deliveries.
- Check Run name is the constant `license/cla`. Do not rename it.
- PR evaluation: the PR opener **and** every non-exempt commit author and committer must be covered (commit emails are spoofable). Committer is exempt if equal to author or GitHub `web-flow`; merge commits are skipped. Covered = same document and signature major equals the active major. List PR commits (cap 250, then page repo commits); use author and committer numeric ids. A `null` or `{}` author means an unlinked email: a first-class failure state with fix instructions, overridable only by an audited per-commit `commit_overrides` row that never implies a signature. `Co-authored-by` trailers have no numeric id: resolve only the `ID+login@users.noreply.github.com` form, otherwise advisory only; ignore bot and AI trailers. Classify bots from the PR opener's account type plus numeric id or app slug, never from email or login strings. Record the covering basis in `pr_evaluations`.
- Authorization: use the installation token and numeric ids to check org role or repo permission, cached with a short TTL. Every query filters by installation id; cross-tenant tests are mandatory. Role matrix is in README.
- Output encoding: CSV export prefixes cells starting with `=`, `+`, `-`, `@`, tab or CR. PR comments and check summaries escape markdown, wrap names in code spans, neutralise `@` and `#`. Hostile-name tests are mandatory.
- Cookies: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, idle and absolute expiry. Login uses a short-lived Lax state cookie plus PKCE, a **new session id** at the callback, relative-only `return_to`, no mutation on GET. CSRF token plus `Origin` check on state changes; the webhook route is exempt and relies on HMAC only. Delete sessions on a `github_app_authorization` revoke event. Set `trustProxy` correctly or rate limits key on the proxy IP.
- SPA is served by Fastify from the same origin. No tokens in `localStorage`.
- Poison jobs: bounded `retryLimit` plus a dead-letter handler that sets the Check Run to `failure` with a `/recheck` hint.
- Network metadata (IP, user agent) is not recorded unless an explicit config flag enables it.
- No legal text ships by default; maintainers upload their own CLA.

## Testing

- Vitest `projects`: `server` (node environment) and `web` (jsdom + Testing Library + user-event + jest-dom + MSW 3). Coverage is process-wide, run once with `yarn coverage`. The 100% gate runs in jsdom, not Vitest Browser Mode (v8 coverage is Chromium-only there).
- Database tests use PGlite (single connection, in-memory, Postgres 18). CI also runs the suite against a real Postgres 18 service via `DATABASE_URL`. Pin the PGlite version; minor upgrades may change on-disk format.
- Snapshots: `toMatchInlineSnapshot` for small values; `toMatchSnapshot` only for small structural output where an inline literal would be noise; `toMatchFileSnapshot` for API JSON and CSV export, into a dedicated directory, never `__snapshots__/*.snap`. With `CI` set Vitest writes no snapshots and fails on missing ones; outside CI it writes them and passes, so the gate always runs with `CI=1` and new snapshot files must be committed.
- Vitest 5 defaults: `clearMocks: true`, fails on unawaited `expect().resolves/rejects`, no config search in parent dirs, reports under `.vitest/`. `vite` is now an explicit peer: add it as a devDependency. `@vitest/coverage-v8` must match the exact Vitest version.
- Vitest `related` needs `--run` and `--passWithNoTests`; never add `--coverage` to it (100% thresholds fail on partial runs).
- Stryker: use `@stryker-mutator/*` 10.1+ (Vitest 5 support landed in 10.1.0). It forces coverage off and one worker, so mutate only the node/unit project. Open bugs: `--logLevel debug` crashes on Vitest 5 (#6272), nondeterministic perTest verdicts (#6073); Browser Mode unsupported. Gitignore `.stryker-tmp`; cache `reports/stryker-incremental.json` in CI. Incremental misses dependency, env and snapshot changes: use `--force` after those.
- Playwright: visual baselines come from one environment. Image tag must equal the package version exactly (`mcr.microsoft.com/playwright:v<version>-noble`), run with `--init --ipc=host`. Never regenerate baselines on the host. Omit `{platform}` from `snapshotPathTemplate`. `animations: 'disabled'` is default; set `maxDiffPixels` explicitly. Bump image and package together.
- memlab 2.x drives Chromium through Puppeteer (separate browser download; `--chromium-binary` can reuse one). No leak-based exit code was found (unverified). Wrap it with `@memlab/api` `run()` and fail on `leaks.length`; the wrapper lives in `tests/leaks/`. Node 26 compatibility is unverified: smoke-test first. Use `vitest --logHeapUsage` and `node --heap-prof` / `--cpu-prof` for diagnosis.

## Tooling gotchas

- **Corepack is not bundled with Node 25+.** `npm install -g corepack` before `corepack enable` (also in Dockerfiles and CI). Node 26 Linux binaries link `libatomic`; slim images may need it.
- **Yarn Berry never runs `prepare`.** Install hooks from root `postinstall` (`lefthook install`). Docker builds have no `.git`: use `yarn install --immutable --mode=skip-build` there. Yarn 4.14+ defaults `enableScripts` to false, so third-party postinstalls (including lefthook's own) are skipped; root-workspace scripts still run.
- `.yarnrc.yml`: `nodeLinker: node-modules` (PnP has known Playwright bugs and unverified support elsewhere). `yarn install --immutable` in CI.
- Node version sources: `.nvmrc`, `mise.toml`, `devEngines.runtime`, `packageManager` (with hash, written by `corepack use yarn@4.x`). Node ignores `engines`; Yarn does not enforce it. mise ignores `.nvmrc` unless configured, so `mise.toml` is canonical. fnm `--corepack-enabled` fails on Node 25+.
- **Lefthook v2**: use `jobs:` (list order is run order). `files` is a shell command, not a pattern. Set `glob_matcher: doublestar` or `**/*.ts` misses root files. `stage_fixed` is pre-commit only. Default execution is sequential and does not stop on failure: use `piped: true` for fail-fast, `group:` for nested parallel. `parallel` and `piped` together is an error. Set `assert_lefthook_installed: true`. `skip: [merge, rebase]` on slow jobs. A new branch without upstream makes `{push_files}` equal all tracked files. A global `core.hooksPath` blocks `lefthook install`. Hooks cannot enforce themselves: CI must repeat them.
- **ESLint 10**: flat config only (`eslint.config.mjs`), `defineConfig` from `eslint/config`, `tseslint.configs.strictTypeChecked` and `stylisticTypeChecked`, `parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }`. Do not use `--cache` (stale for type-aware rules). Use `--no-warn-ignored`. `eslint-plugin-jsx-a11y` peers stop at ESLint 9: use Biome a11y rules instead. `eslint-plugin-react-hooks` 7 `configs.flat.recommended` includes React Compiler rules. `eslint-config-biome` (third party, last published 2025-12) turns off overlapping rules: place it last and verify against the installed Biome version. Found while building the caps tool: `strictTypeChecked` rejects numbers in template literals, so set `@typescript-eslint/restrict-template-expressions` to `{ allowNumber: true }`; `sonarjs/no-alphabetical-sort` requires a comparator on every `.sort()`; `sonarjs/no-os-command-from-path` fires on `execFileSync('git', ...)` and is suppressed inline with a written reason (the argv is fixed); use `toThrow`, not the deprecated `toThrowError`; never feed `JSON.parse` output (`any`) straight into an expression, assign it to an `unknown` variable first (type-coverage).
- **Biome 2.x**: `files.includes`, `assist.actions.source.organizeImports`, `linter.rules` presets; `rules.recommended` is deprecated. Use `biome check --write --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}` in hooks, `biome ci` for read-only. Style used by the existing code: 2 spaces, single quotes, `lineWidth` 120; use `"preset": "recommended"` (the `recommended` flag is deprecated). Turn `complexity/useLiteralKeys` **off**: it rewrites `record['key']` to `record.key`, which `noPropertyAccessFromIndexSignature` forbids.
- **FTA** exits at the first file above `score_cap` without printing a report: run a second pass without the cap (`--json`) for the full list. v2 and v3 changed scoring: pin the exact version. Tests are scored unless excluded.
- **Knip**: `--strict` implies `--production` and ignores devDependencies, hence two runs. Mark production entries with `!`. Plugins exist for Vite, Vitest, Playwright, ESLint, Stryker, Lefthook, Biome. Exit codes: 0 clean, 1 issues, 2 error.
- **Semgrep**: use `semgrep scan --error --metrics off`, not `semgrep ci` (it ignores `--config` and targets the platform). No login needed. A custom `.semgrepignore` replaces defaults: re-list `node_modules`, `dist`, `build`. Default ignores skip `/test`. For offline use, download each `https://semgrep.dev/c/p/<name>` into `rules/` and **git-ignore it**: the Semgrep Rules License v1.0 restricts redistribution, so the rules must not be committed to this AGPL repo.
- **Trivy**: dev dependencies are skipped without `--include-dev-deps`; misconfig must be named in `--scanners`; `--severity` also filters secrets. Secret scanning needs no vulnerability DB (fast for pre-commit). **Supply-chain incident (March 2026, CVE-2026-33634):** Trivy v0.69.4 (and Docker Hub v0.69.5-6) were malicious, and `trivy-action` tags 0.0.1 to 0.34.2 plus `setup-trivy` tags were repointed. Use Trivy v0.76.1 or later pinned exactly, `trivy-action` 0.35.0 or later and `setup-trivy` v0.2.6 or later, each pinned by full commit SHA, and pin every other Action the same way. Never reference older tags.
- **Qodana**: linter `qodana-js` (image `jetbrains/qodana-js:2026.x`), `qodana.yaml` with `version: "1.0"`, `failThreshold`, needs `QODANA_TOKEN` and a paid Ultimate or Ultimate Plus licence. Gate failure exits 255. Fork PRs get no secrets, so it is not a required check for external contributors.
- **Vite 8 / React**: Rolldown + Oxc replace esbuild/Rollup (`build.rolldownOptions`, `oxc` config keys). `@vitejs/plugin-react` 6 has no Babel option. Keep React and react-dom on the identical version. TanStack Router uses code-based routes (no codegen).
- **Octokit** packages are ESM-only; the server tsconfig must use `nodenext`.

## Code caps tool

`node scripts/check-code-caps.ts` (entry) with the logic in `scripts/code-caps/` (`types`, `naming`, `measure`, `files`, `baseline`, `cli`; tests are co-located). It is a port of the maintainer's Python tool `check_code_caps.py` and writes the same baseline format (`{"version": 1, "caps": {...}, "violations": {"<path>::<kind>::<name>": value}}`).

- Flags: `--root <dir>`, `--init` (first run only), `--force` (with `--init`), `--update-baseline` (ratchets down, refuses new or grown violations). **Agents never run `--init`, `--force` or `--update-baseline` to hide a violation: fix the code.** Exit codes: 0 ok, 1 new or grown violation, 2 unusable input (syntax error, corrupt baseline, unknown option).
- Measures every `.ts .tsx .mts .cts .js .jsx .mjs .cjs` file. Inside git: tracked plus untracked-not-ignored, so **`.gitignore` must list build and report output** (`coverage dist build reports playwright-report test-results .stryker-tmp .vitest`); git mode does not prune those by name. Outside git (plain walk) those output dirs are pruned by name. Tool dirs `.git .gitnexus .claude .idea .yarn node_modules` are skipped at any depth in both modes. A source-extension file name that is not valid UTF-8 is an error (exit 2), never skipped.
- Counts: function = any function-like node with a body (declarations, expressions, arrows, methods, constructors, accessors, static blocks), decorators and modifiers included in its span; params = parameters (a fake `this` is free; rest counts one; parameter properties count); nesting = if/for/for-in/for-of/while/do/try/switch/with levels inside one function (`else if` does not deepen, `else { if }` does; bare blocks and labels are transparent; nested functions and callbacks are measured on their own).
- Names are qualified (`Class.method`, `outer.inner`, `Namespace.fn`, `config.handler` for a function inside a named object literal). Unnamed functions take the name of the variable, property or assignment target that receives them (parentheses, `as`, `satisfies`, `!` and `<T>` wrappers are looked through), `default` for a default export, else `<anonymous>`. A callback passed to a call is named from the call, not its position: `describe("title")`, `items.map()`, so fixing one callback never renumbers the baseline keys of its siblings. Remaining repeats get `#2`, `#3`. Keys sort by code point (not locale), so the order is the same on every machine. Names and paths are escaped (`\xNN`) when printed so control characters cannot forge report lines.
- Baseline write is atomic (temp file plus rename). Any unexpected failure while measuring a file is reported as `<path>: cannot measure: ...` (exit 2).
- Known differences from the Python original, accepted: no `--help` or argparse prefix abbreviations (unknown options exit 2), lenient UTF-8 decoding of file contents, TS parser rejects sloppy-mode JS octal literals, TS syntax inside a `.js` file is a parse error, a nonexistent `--root` exits 2, lines split on `\n`, `\r\n`, `\r`, U+2028, U+2029 only, an empty `switch {}` has depth 0. Not guarded: huge files, symlinks pointing outside the root, baseline `version` validation.
- Needs the `typescript` 6.x package (classic compiler API), default import only. Syntax errors are detected through a one-file `ts.createProgram` (`getSyntacticDiagnostics`) and exit with 2.

## GitHub App rules

- Minimum permissions are in README. Do not add permissions without a reason recorded in the README table.
- User tokens (`ghu_`) expire in 8 h and refresh tokens are single-use. We do not store them.
- Installation tokens: 1 h. App JWT: max 10 min. Honour `retry-after` on 403/429 (secondary limits: 100 concurrent requests, 900 points/min per endpoint).
- A check and a commit status with the same name must both pass; we only create Check Runs. CLA Assistant posts a legacy status with context `license/cla`: repos migrating from it must disable it first, or use a distinct check name.
- Checks must be reported on the latest head SHA. "Re-run all checks" sends `check_suite.rerequested`, a single re-run sends `check_run.rerequested`: handle both (Checks: write covers them).
- Supporting PR comments needs only Pull requests: write; `issue_comment` events need Issues: read.
- The App supports multiple private keys: deploy the new key before deleting the old one.
- Verify the noreply email form (`ID+login@users.noreply.github.com`) and the `web-flow` committer identity before using them to map emails.

## GitNexus

Dev tooling only, never a gate. `gitnexus analyze` writes `.gitnexus/` (self-ignoring) and appends a managed block to `CLAUDE.md` and `AGENTS.md` between `<!-- gitnexus:start -->` and `<!-- gitnexus:end -->` plus `.claude/skills/gitnexus-*`. Do not hand-edit inside the markers. Use `--skip-agents-md` or `--skip-skills` to keep this file untouched. Licence is PolyForm Noncommercial: it is a dev-time tool whose output we do not ship, but check it before relying on it for a commercial product.

## Known unverified (resolve at scaffold, then delete from this list)

- Exact pg-boss queue policy for per-(repo, PR) serialisation without dropped sends.
- GitHub `web-flow` committer numeric id, and the `ID+login@users.noreply.github.com` form.
- memlab having no leak-based exit code.
- Whether Yarn 4 resolves both `tsc` binaries cleanly if a TS 7 native alias is ever added (not planned).
- `type-coverage` following project references from a `files: []` root: run per project with `-p` until proven otherwise.
- Stryker `vitest-runner` 10.1.x against Vitest 5.0.x in this repo's layout; memlab on Node 26; `@rolldown/plugin-babel` peer range if React Compiler is enabled.
- `lefthook install` guard for Docker/CI without `.git` in the root `postinstall`.
- Biome rule name `security/noDangerouslySetInnerHtml` and the `--staged` VCS requirement.
- Legal: e-signature validity (ESIGN, eIDAS) and GDPR retention choices need counsel; this repo contains no legal advice.
