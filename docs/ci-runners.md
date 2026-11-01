<!--
SPDX-License-Identifier: AGPL-3.0-only
Copyright (C) 2026 Giovanni Manzoni
-->

# CI runners policy

Where the CI of this repository runs, what that exposes, and the rules every job and every pull request approval must follow. Written 2026-11-01 from the maintainer's decisions; if a decision changes, change this file, [`README.md`](../README.md) and [`CLAUDE.md`](../CLAUDE.md) in the same pull request.

## Purpose and scope

- This is the single source of truth for CI runner policy. A user story that adds, moves or changes a CI job links to this file and has to satisfy [Rules for adding a job](#rules-for-adding-a-job). A change that reviews or approves a fork pull request follows [Fork PR approval](#fork-pr-approval).
- It covers every workflow in `.github/workflows/`, the helper scripts in `scripts/ci/`, the development database helper in `scripts/dev/`, and the ports those use.
- It does not cover the GitHub App's own hosting (the self-hosting epic owns that) or production deployment.
- The guard `yarn ci:runners` (`scripts/ci/check-runners.ts`) enforces the mechanical part of these rules on `.github/workflows/`. It catches accidents and reviewed changes. It is not a security boundary: a hostile pull request can edit the guard too, which is why [the approval gate](#fork-pr-approval) comes first.

## Runner exposure

The maintainer's decision, quoted:

> Runner exposure: shared runners with the approval gate as the only protection.

In plain words:

- Every job of this repository runs on the maintainer's **existing self-hosted runners**: organisation-level, persistent (not ephemeral), labels exactly `self-hosted`, `Linux`, `X64`. The same runners also serve other repositories of the organisation (for example `c15t`).
- The organisation is on the free plan and has only the **Default runner group**, which is open to all repositories, public ones included. Nothing in a workflow file can narrow that. Any repository of the organisation can send a job to these runners, and the other way round.
- A job runs as the **runner user**, on a host that is **shared** with those other repositories, with whatever that user can reach: the other repositories' work directories and tool cache (as far as file permissions allow), the Docker daemon (a user in the `docker` group is root-equivalent on the host), the network the host is on, and any credential stored on the host.
- Therefore **approved fork code runs as the runner user on a host shared with other repositories**. The only thing between a stranger's pull request and that host is the maintainer reading the pull request before approving it.
- A `runs-on` expression inside a workflow is **not** a boundary. On `pull_request`, the workflow file comes from the pull request itself, so its author chooses the runner. The pattern "fork goes to `ubuntu-latest`, everyone else to `self-hosted`" (used in `c15t`) is forgeable and must not be copied.
- Hygiene (below) limits accidents and the blast radius of a mistake. It does not stop a determined author of approved code.

## Fork PR approval

Setting, applied 2026-11-01 and verified with the API the same day: **Require approval for all external contributors** (`all_external_contributors`). No workflow from a fork runs, on any runner, until the maintainer approves it.

Verify it any time (read-only):

```sh
gh api repos/Axiumine/cla-gate/actions/permissions/fork-pr-contributor-approval
# {"approval_policy":"all_external_contributors"}
```

If the answer is anything else, stop approving fork runs and fix the setting first (repository Settings, Actions, General, Fork pull request workflows).

Approving means **you have read the whole diff first**. Do not approve from a notification, a title or a description. Checklist, for every fork PR and again after every push to it:

1. Read the **entire diff**, not only the files that look relevant. Binary files, generated files and large lockfile changes included.
2. `.github/`: any workflow, composite action, `dependabot.yml`. Refuse any workflow change from a fork: a legitimate one comes from a same-repository branch.
3. `package.json`: every `scripts` entry and the root `postinstall` (it runs on `yarn install`), `devEngines`, `packageManager`, `resolutions`.
4. `.yarnrc.yml` (registry, plugins, `yarnPath`, `enableScripts`, hooks) and `yarn.lock`: new packages, changed `resolution:` lines, anything resolved from a URL, git repository or tarball instead of the registry.
5. `lefthook.yml` and `.nvmrc` / `mise.toml`: they run commands or fetch toolchains.
6. Every **executable config file**: `eslint.config.mjs`, `vitest.config.ts`, `knip.json`, `biome.json`, `fta.json`, `tsconfig*.json`, `docker-compose.yml`, `docker/`, and anything else loaded by a tool during `static`, `coverage` or `postgres`.
7. `scripts/` and all tests, including `*.test.ts` and test setup files such as `global-setup.ts`: tests are code and run on the host.
8. Refuse, or ask first, anything that:
   - adds a network call (`fetch`, `curl`, a download, a registry or URL change),
   - adds or changes a dependency without a stated reason, or one that is not AGPLv3-compatible,
   - touches `.github/`, the runner guard, the hooks or the Yarn config,
   - reads files outside the workspace, the environment, `~`, `/proc`, or the Docker socket,
   - starts containers, background processes or listeners other than through the helpers in `scripts/ci/`.
9. Only then use "Approve and run". If the contributor pushes again, read the new diff before approving the new run.

Not covered by that setting: pull requests from branches of this repository (including Dependabot's). Those need no approval, so anyone with write access, and a compromised dependency that Dependabot proposes, reaches the runners without a human reading the diff. See [Known unknowns and risks](#known-unknowns-and-risks).

## Where each job runs and why

| Job | Runner class | Reason |
|---|---|---|
| `static` (required check) | Self-hosted, `[self-hosted, Linux, X64]` | Needs git and Node only. Runs repository code, so on this shared host it is protected by the approval gate and the hygiene rules, nothing else. |
| `coverage` (required check) | Self-hosted, `[self-hosted, Linux, X64]` | Same as `static`. |
| `postgres` (informative) | Self-hosted, `[self-hosted, Linux, X64]` | Needs a Docker daemon the runner user can reach. Starts the database through `scripts/ci/postgres.ts`, no `services:` block. |
| `release.yml`, `scorecard.yml` (do not exist) | GitHub-hosted, `ubuntu-24.04` | Decision: they stay on GitHub-hosted runners if they are ever added. The guard (R2) enforces it. |
| CodeQL default setup, Dependabot updates | Run by GitHub | GitHub-run features; nothing in this repository selects their runner. |

Nothing else needs a GitHub-hosted runner today. Each future job is judged when it is written.

## Rules for adding a job

### Where it may run

A job belongs on a GitHub-hosted runner (`ubuntu-24.04`) only if at least one of these is true; otherwise it uses `[self-hosted, Linux, X64]`:

- it runs **untrusted code** that must not touch the shared host,
- it needs a **platform the self-hosted runners lack**,
- it is a **GitHub-run feature** (CodeQL default setup, Dependabot updates),
- it must work **when the maintainer's infrastructure is down** (for example a runner-offline watchdog),
- it is a deliberate **clean-room reproducibility check**.

Write the reason in the workflow comment and in the table above.

### Hygiene on a shared, persistent host

Every job, whatever the runner:

- `runs-on` is the **literal** `ubuntu-24.04` or the **literal list** `[self-hosted, Linux, X64]`. Never an expression, a matrix value, the `group` / `labels` form, `ubuntu-latest` or another label.
- `timeout-minutes` on every job, at most 60 (the runner's own limit is days; a job that needs more is a design question for the maintainer).
- Workflow-level `permissions: contents: read`, and nothing more. `release.yml` and `scorecard.yml` may add `security-events: write` and `id-token: write`.
- `persist-credentials: false` and `clean: true` on `actions/checkout`.
- **No secrets.** The repository has none today; do not add any to a job that runs on the shared runners.
- **Unique per-run names** for anything the job creates on the host (containers, networks, temp directories): derive them from `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT` passed through `env`, never by interpolating attacker-controlled fields (branch names, PR titles) into a `run:` block.
- **Cleanup in an `if: always()` step**, so a failed or cancelled job leaves nothing behind.
- **No `sudo`.** Nothing written outside the workspace, the runner's temp directory and the tool cache. A "Keep tool state" step, before checkout, points every tool at `$RUNNER_TEMP`: Corepack (`COREPACK_HOME`), Yarn (`YARN_GLOBAL_FOLDER`), npm (`npm_config_cache`), the XDG data and cache directories (Vitest's token, Biome's cache) and `TMPDIR` (Node's compile cache, the temp directories of tests). Without it those land in the shared runner user's home directory and `/tmp`. Corepack itself is installed with `npm install --global --prefix "$RUNNER_TEMP/npm-global"` and that `bin` is added to `GITHUB_PATH`, never into the Node of the tool cache: two jobs installing into one directory at the same time can leave it without the binary.
- **No git hooks in CI.** The root `postinstall` (`scripts/dev/install-hooks.ts`) skips `lefthook install` when `CI` is set, and when there is no `.git`. On a persistent workspace a hook would outlive `node_modules`: the next run's checkout deletes `node_modules` (`git clean -ffdx`), then `git checkout` fires the `post-checkout` hook, which with `assert_lefthook_installed: true` cannot find Lefthook and fails the checkout. CI repeats every hook check anyway.
- A **fail-fast preflight step** first, with a clear message when a tool, the Docker daemon or disk space is missing: at least **4096 MiB** free in the workspace, `git`, `curl` and `tar` on the PATH, and for a job that uses Docker a daemon the runner user can reach (`docker info`). Do not assume more than that. The preflight script itself also uses `awk`, `df`, `id` and `uname`, which any POSIX host has.
- No `pull_request_target`, no `workflow_run`, no job-level `uses:` of a reusable workflow.
- Every third-party action pinned by full commit SHA, with the version in a comment.

### The guard

`yarn ci:runners` reads every `.yml` and `.yaml` file directly inside `.github/workflows/` and prints one line per violation (`file: job "id": R1 message`). It runs in the `static` job and in the `pre-push` hook, the same script. Exit codes: 0 ok, 1 violations, 2 unusable input (malformed YAML, a file that is not a workflow, a missing directory).

| Rule | What it enforces |
|---|---|
| R1 | Every job without `uses` has `runs-on` equal to the literal `ubuntu-24.04` or the literal list `[self-hosted, Linux, X64]` (exact, case-sensitive, that order). No `${{` expression, matrix value, `group` / `labels` object, `ubuntu-latest` or other label. |
| R2 | In every file whose name contains `release` or `scorecard` (`release.yml`, `release-please.yaml`, `Scorecards.yml`, any case, any position) every job is exactly `ubuntu-24.04`. A harmless `release-notes.yml` is caught too: rename it. |
| R3 | The triggers `pull_request_target` and `workflow_run` are forbidden. |
| R4 | Every job has `timeout-minutes`, a positive number of at most 60 (an expression cannot be checked, so it is rejected). |
| R5 | A top-level `permissions` key exists and holds `contents: read` and nothing else; release and scorecard files may add `security-events: write` and `id-token: write`. A job-level `permissions` block is held to the same allowed set, because an override could escalate what the top level restricts. |
| R6 | Job-level `uses` (a reusable workflow) is rejected as unsupported until the checker is extended. |
| R7 | Job-level `container:` and `services:` are rejected as unsupported, on any runner: a container with `--privileged` or a bind mount of `/` defeats every other rule, and `ports: 5432:5432` publishes a well-known port on all interfaces. Containers start from a `run:` step through the `scripts/ci/` helpers (random loopback port). |

What the guard does **not** check, and review must: what a `run:` step executes (a `docker run` there is not inspected), which third-party actions are used, composite actions under `.github/actions/`, and the content of any script a step calls. It also does not check the hygiene rules above: that `actions/checkout` has `persist-credentials: false` and `clean: true`, that actions are pinned by commit SHA, that no secret is used, that the cleanup step has `if: always()`, that a job starts with the preflight, and that tool state is redirected to `$RUNNER_TEMP`. `scripts/ci/ci-workflow.test.ts`, `ci-preflight.test.ts` and `ci-tool-state.test.ts` pin those for `ci.yml` only (they run in the `coverage` job); a new workflow file has no such test, so review it against the list. The YAML parser rejects duplicate keys, several documents in one file and alias bombs; a merge key (`<<`) is not expanded, so a job that relies on one fails R1 instead of slipping through.

## Ports

- **Rule:** any port this repository needs (CI service containers, the development database, tests, later the web dev server) is a **random port that is free at the time of use, between 32769 and 60999, bound to `127.0.0.1` only**. No fixed well-known ports (5432, 3000, 8080, 5173) in CI, compose, scripts or tests.
- **Helper:** `scripts/ci/lib/ports.ts` picks the port: a random draw from the range (`crypto.randomInt`), a real probe that tries to bind `127.0.0.1`, up to 50 draws. `yarn ci:port` prints one. `yarn ci:postgres start` and `yarn db:up` use it, and both retry with a new port when Docker reports that the chosen one was taken in between (the probe and the bind are two steps).
- **Why Docker's own assignment is not enough:** with `-p 127.0.0.1::5432` Docker hands out the next free port of the host's ephemeral range in sequence, so it is guessable, and the range itself is a host sysctl (`net.ipv4.ip_local_port_range`) that other machines may change. Port 0 for a process asks the kernel, which draws from the same range.
- **Loopback only:** `-p 127.0.0.1:<port>:5432`. Never `-p <port>:5432` (all interfaces) and never `ports: 5432:5432` in a `services:` block.
- **Container side:** the `5432` after the second colon is Postgres' own port inside its container. It is not a host port.
- **The runner needs no inbound port.** It connects out over HTTPS to GitHub; open nothing on the host for it.
- **The dev server:** `yarn dev` goes through `scripts/dev/db.ts run app`, which picks a port the same way, sets `PORT`, and prints `app: http://127.0.0.1:<port>` before it starts the server. An explicit `PORT` in the environment wins. `node --watch` restarts keep the port, because it is chosen once. `curl` the address that line shows.
- **The one remaining 3000:** `DEFAULT_PORT = 3000` in `src/server/config/env-schema.ts` is the application's own configuration default, used when nobody sets `PORT`: `yarn start`, a container, or a process manager. That is a deployment setting the self-hosting epic owns, and it is a recorded exception to the rule above, not an oversight. No script, compose file, CI job or test starts anything on it, and the app binds `127.0.0.1` by default (`HOST`).
- **Tests that listen** (`boot.test.ts`, `main.test.ts`, `framework-errors.test.ts`, the silent Postgres of `test-support.ts`, `ports.test.ts`) take their port from `pickSystemFreePort()`, never from port 0. Port 0 asks the kernel for a port from its ephemeral range, which is the host sysctl this rule exists to avoid.

Audit of fixed ports, 2026-11-01 (grep over `src`, `scripts`, `docker`, compose, workflows, docs, tests):

| Where | What | Status |
|---|---|---|
| `docker-compose.yml` | `127.0.0.1:5432:5432` | Fixed: `127.0.0.1:${POSTGRES_PORT:?...}:5432`, no default |
| `.github/workflows/ci.yml` | `services:` with `ports: 5432:5432`, `DATABASE_URL` on `localhost:5432` | Fixed: no `services:`, `scripts/ci/postgres.ts` |
| `package.json` `dev`, `db:migrate` | default URLs on `127.0.0.1:5432`, and the server on its default 3000 | Fixed: `scripts/dev/db.ts run` uses the remembered database port or an explicit variable, and for `app` a random free `PORT` |
| `README.md`, `CLAUDE.md` | `5432` in commands and advice | Fixed: rewritten for `yarn db:up` |
| `src/server/config/env-schema.ts` | `DEFAULT_PORT = 3000` | Recorded exception: the application's configuration default for `yarn start` and deployments (self-hosting epic); no script, compose file, CI job or test uses it; `HOST` defaults to `127.0.0.1` |
| `src/server/main.test.ts`, `boot.test.ts`, `framework-errors.test.ts`, `test-support.ts`, `scripts/ci/lib/ports.test.ts` | `PORT: '0'`, `listen(0, '127.0.0.1')`, `port: 0` | Fixed: `pickSystemFreePort()`, 32769 to 60999, loopback only |
| `src/server` unit tests and `test-support.ts` (`env`, `security`, `app-errors`, `migrate`, `migrate-cli`, `pg`, `test-support`), a doc comment in `boot.ts`, and the helper tests in `scripts/ci` and `scripts/dev` | fake `host:port` strings such as `db.internal:5432`, `localhost:3000`, `127.0.0.1:1` (nothing listens there), or the helper's own port-range fixtures | Test-only values, nothing binds them |

## Containers and cleanup

- `scripts/ci/postgres.ts start` runs the digest-pinned `postgres:18` image as `cla-pg-<run id>-<attempt>-<random>` with the label `cla-gate.ci=postgres`, on a random loopback port, with a per-run random password. It masks the password (`::add-mask::`), appends `CLA_PG_CONTAINER` to `GITHUB_ENV` **before** docker runs, waits for the health check (over TCP, not the init-time socket), and appends `DATABASE_URL`. The password reaches docker through the child's environment (`--env POSTGRES_PASSWORD` without a value), never through argv, so it does not show in the process list.
- Any failure inside `start` removes the container again. `scripts/ci/postgres.ts stop` (the `if: always()` step) removes it with its volume and is idempotent: a container that is already gone is not an error.
- The step condition is `always() && env.CLA_PG_CONTAINER != ''`, so a job that failed before the helper ran skips the cleanup instead of failing it.
- Container logs shown on a failed start are printed with a `| ` prefix and with control characters escaped, so nothing a container prints can pass for a workflow command.
- Leftovers (a killed runner, a power cut) are found with `docker ps -a --filter label=cla-gate.ci=postgres` and removed with `docker rm -f --volumes <name>`. Nothing sweeps them automatically.
- The pulled image stays in the host's image cache, shared with the other repositories. That is intended: the digest pin keeps it reproducible.
- Other repositories' containers on the same daemon are never touched. `stop` refuses a name that does not start with `cla-pg-`, inspects the container first and refuses one that does not carry the label `cla-gate.ci=postgres`, and `start` does not run its failure cleanup when `docker run` failed because the name was already taken (that container is someone else's). A container that is already gone is not an error.

## Known unknowns and risks

- **Runner capabilities, as read from the first run (2026-11-01, a same-repository branch, then a re-run).** The preflight and the job logs show Linux x86_64 with the user `runner`, `git`, `curl` and `tar` present, 43 to 197 GB free in the workspace, Node v26.13.0 from the tool cache, Docker server 29.9.2 reachable by the runner user, the postgres container healthy on a random loopback port in range (36120, then 39409) with the suite passing against it and the container removed by the job's own cleanup step, and on the re-run the Yarn cache restored and the checkout passing on a used workspace. The three jobs ran on three different runners. **Still unverified** (E23-S11): that `docker ps -a --filter label=cla-gate.ci=postgres` is empty on the host after a job and after a cancelled run, that nothing new appears in the runner user's home directory or in `/tmp`, and that a fork pull request shows "Approve and run" and runs nothing before it is approved.
- **The host is shared and persistent.** Nothing is ephemeral. A job can leave files in the work directory, the tool cache (`actions/setup-node` downloads Node there; other repositories using the same Node version share it, so nothing else is installed into it: Corepack goes into a per-job prefix) and the Docker image cache. Hygiene limits this; it does not remove it.
- **No isolation between repositories.** See [Runner exposure](#runner-exposure). The organisation's Default runner group is left untouched on purpose (free plan, one group, maintainer's decision).
- **Same-repository and Dependabot pull requests are not gated.** Anyone with write access, and a malicious release of a dependency that Dependabot proposes, runs code on the runners without approval. Mitigations: Yarn's one-day `npmMinimalAgeGate`, Dependabot's seven-day cooldown, install scripts of third-party packages off (`enableScripts`), and reading the lockfile diff of dependency pull requests.
- **The guard is not a boundary.** A pull request can change or delete the guard and the `static` step that runs it. It protects against accidents and against changes a reviewer reads.
- **If every runner is offline, the required checks wait forever.** `static` and `coverage` never start, so nothing can merge. Break-glass, for a same-repository pull request: change `runs-on` of the three jobs to the literal `ubuntu-24.04` in that pull request. The workflow file of a same-repository pull request comes from the pull request, so its own checks then run on GitHub-hosted runners. The guard **accepts** that literal (R1 allows `ubuntu-24.04` for any job), and so does `scripts/ci/ci-workflow.test.ts` (it accepts either allowed runner, the same one in all three jobs, and a test replays this exact edit), so neither the `static` nor the `coverage` check fails on it and nothing else needs to change in that pull request. The edit does not block the merge by itself: the control is the maintainer, who must say in the pull request that this is temporary, and revert it in a follow-up pull request once the runners are back, so that this document and the workflow agree again. The last-resort unblock for branch protection itself is in [`CLAUDE.md`](../CLAUDE.md), Repository protection.
- **The Docker daemon is shared.** Container and image names are per run, ports are random, but another repository's job can list our containers. The password of the CI database is therefore only a throw-away credential for a database that exists for minutes on loopback.
- **Caches.** `actions/cache` stores the Yarn cache under `$RUNNER_TEMP/yarn/cache`; the first run on the self-hosted runners started cold (2026-11-01) and the re-run restored it.

## Change log pointer

History is the git log of this file: `git log --follow -- docs/ci-runners.md`. Any change to the policy lands together with the matching edits to `README.md` (Quality gates, CI, Decisions) and the pointer lines in `CLAUDE.md`.
