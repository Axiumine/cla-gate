# Toolchain: tools, hooks and CI

Which tools run, when they run and what CI enforces. The thresholds are in [`quality-gates.md`](quality-gates.md), the scripts in [`development.md`](development.md), and the traps of each tool in [`tooling-gotchas.md`](tooling-gotchas.md).

Everything is strict by default: 100% coverage, zero lint findings, 100% type coverage, no unused code and ratcheted structural caps; a mutation-score floor joins when Stryker lands (deferred). Hooks give fast local feedback; **CI is authoritative** because hooks are bypassable.

## Tool evaluation

| Tool | Verdict | Where | Notes |
|---|---|---|---|
| Node 26 LTS + Corepack + Yarn 4 | Adopt, adjusted | everywhere | Corepack is **no longer bundled** since Node 25: `npm i -g corepack && corepack enable`. Pin via `.nvmrc`, `mise.toml`, `devEngines`, `packageManager`. Yarn 4.18 |
| mise (over fnm) | Adopt | dev | mise ignores `.nvmrc` unless configured, so commit `mise.toml`; fnm's `--corepack-enabled` is broken on Node 25+ |
| Biome | Adopt | hooks, CI | Formatter, import sorting, a11y, non-type-aware lint, cognitive complexity. Formats YAML too; its Markdown formatter is switched off (it rewrites table separators) |
| ESLint + typescript-eslint `strictTypeChecked` + sonarjs | Adopt | hooks, CI | `--max-warnings 0`, **no `--cache`** (stale for type-aware rules). Type-aware rules, sonarjs, security, complexity. `eslint-config-biome` is not used: it would switch off the type-aware `no-floating-promises` and `no-misused-promises` |
| eslint-plugin-security, no-unsanitized | Adopt | hooks, CI | Both work on ESLint 10; the security preset is escalated from warn to error. Plus Biome `noDangerouslySetInnerHtml` because no-unsanitized does not cover React |
| jsx-a11y | Skip | n/a | Plugin peers stop at ESLint 9; Biome a11y rules cover it |
| tsc -b + strict flags + type-coverage | Adopt | pre-push, CI | TypeScript pinned to 6.0.x (see [Decisions](decisions.md#decisions)) |
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
| Lefthook | Adopt | hooks | v2 `jobs:` syntax. Hooks installed from root `postinstall` (Yarn never runs `prepare`), skipped in CI and without `.git` (`scripts/dev/install-hooks.ts`) |
| GitNexus | Adopt as dev tooling | dev | Not a gate. PolyForm Noncommercial licence, and it edits CLAUDE.md |

## Hook pipeline

Order is cheap and deterministic first, expensive and flaky last, and each step only runs if the previous one passed.

| Stage | Scope | Target budget | Jobs, in order |
|---|---|---|---|
| `pre-commit` | staged files | 15 s | 1. `biome check --write --error-on-warnings` (restages fixes). Then in parallel: ESLint on staged files, `vitest related --run` (no coverage), `check-code-caps`, `trivy fs --scanners secret` |
| `commit-msg` | none | n/a | Not used |
| `pre-push` | whole repo | 3 min | 1. `biome ci --error-on-warnings` 2. `tsc -b` 3. in parallel: ESLint full, `type-coverage --strict --at-least 100`, Knip (both modes), FTA, `check-code-caps`, the runner guard (`yarn ci:runners`), `trivy fs` (HIGH/CRITICAL plus secret/misconfig), Semgrep (skipped if not installed) 4. `CI=1 vitest run --coverage` at 100% |
| `post-merge`, `post-checkout`, `post-rewrite` | lockfile change | 1 min | `yarn install --immutable` when `yarn.lock` or `.yarnrc.yml` changed |

Today `lefthook.yml` has no Trivy or Semgrep job: they land with their CI jobs (a hook job must have a CI counterpart), and the `pre-push` hook calls the same `package.json` scripts as CI and `yarn gate` (`yarn lint:biome`, `yarn typecheck`, `yarn lint:eslint`, `yarn type-coverage`, `yarn knip`, `yarn fta`, `yarn caps`, `yarn ci:runners`, `yarn coverage`). `pre-commit` runs staged-file variants of the binaries (`biome check --write`, `eslint`, `vitest related`) and shares only `yarn caps`. `skip: [merge, rebase]` is set on the slow `pre-commit` jobs only; on `pre-push` it would let `yarn gate` pass without running during a rebase. Budgets are targets, not measurements. `lefthook.yml` uses `piped: true` so a failed step stops the rest, with `group: parallel` for the independent static checks in step 3. Formatting runs before linting so lint sees the final text; types run before tests; coverage is last in the hook because it is the most expensive and meaningless if static gates fail. `CI=1` makes Vitest refuse to write new snapshots, so a push cannot go green with uncommitted snapshot files. Mutation, e2e, leak and Qodana runs are nondeterministic or slow and stay in CI.

Network-bound jobs (Trivy vulnerability DB, Semgrep registry rules) can be skipped offline with `LEFTHOOK_EXCLUDE=trivy,semgrep`; that is the only sanctioned hook exclusion, and CI still enforces them. Downloading Semgrep rules into a git-ignored `rules/` cache removes the registry dependency; do not commit them (see [`docs/tooling-gotchas.md`](tooling-gotchas.md), Semgrep).

## CI (authoritative)

`.github/workflows/ci.yml`, every third-party Action pinned to a full commit SHA. `static`, `coverage` and `postgres` exist today; rows marked deferred land together with their tool. All three jobs run on the maintainer's shared, persistent, self-hosted runners (`runs-on: [self-hosted, Linux, X64]`), protected only by the fork-PR approval gate; the policy, the risks, the job rules and the port rules are in [`docs/ci-runners.md`](ci-runners.md). Every job starts with a fail-fast preflight (git, curl, tar, free disk space, and Docker for `postgres`) and keeps Corepack (installed into a per-job prefix, not the shared tool cache), Yarn, npm, the XDG directories and `TMPDIR` under the runner's temp directory. CI installs no git hooks: on a persistent workspace one would fail the next run's checkout. `release.yml` and `scorecard.yml`, if they are ever added, must use GitHub-hosted `ubuntu-24.04`. Job graph:

| Job | Needs | Runs |
|---|---|---|
| `static` | none | Explicit named steps running the same scripts as the `pre-push` hook minus the coverage step: Biome, `tsc -b`, ESLint, type-coverage per project, Knip (both modes), FTA, caps, and the runner guard `yarn ci:runners` (every job must name an allowed runner, have a timeout of at most 60 minutes, least-privilege permissions and no `container:` or `services:`; see `docs/ci-runners.md`) |
| `coverage` | none | `CI=1 vitest run --coverage` at 100%. Runs in parallel with `static` (both are required checks, so a skipped dependent job could not mask a failure). Later: upload `coverage/` for Qodana |
| `postgres` | none | `yarn ci:postgres start` runs a PostgreSQL 18 container (image pinned by tag and digest, no `services:` block) on a random free loopback port with a unique per-run name and password, and exports `DATABASE_URL`; then `yarn test`; an `if: always()` step runs `yarn ci:postgres stop`. The Vitest globalSetup creates a throw-away `cla_test_<hex>` database, the whole suite runs in it, and it is dropped afterwards. Not a required check; it exists to catch a difference between PGlite and a real server (the advisory-lock test only runs here) |
| `mutation` (deferred) | `static` | Stryker `--incremental`, `reports/stryker-incremental.json` restored from cache |
| `e2e` (deferred) | `static` | Playwright in the pinned container, including visual baselines |
| `semgrep`, `trivy` (deferred) | none | Full scans; mandatory, not skippable |
| `leaks` (deferred) | `coverage` | memlab; nightly and release only |
| `qodana` (deferred) | `coverage` | Maintainer-side; needs a token, skipped for fork PRs |

Branch protection on `main` requires `static` and `coverage` today (`postgres` is informative until the team decides to require it); `mutation`, `e2e`, `semgrep` and `trivy` become required once they are stable in CI (see [`CONTRIBUTING.md`](../CONTRIBUTING.md), Repository protection). `yarn gate` is the local equivalent of `static` plus `coverage`. Dependabot (`.github/dependabot.yml`) keeps the SHA-pinned Actions and the npm dependencies current, with a one-week cooldown, grouped; TypeScript stays on 6.0.x.
