# Decisions and open questions

Why the project looks the way it does, and what is still open. A changed decision updates this file in the same pull request.

## Why another CLA tool

As of 2026-11 the common options are ageing or limited:

- **CLA Assistant** (SAP): not archived but near-dormant. No commits between 2023-10 and 2026-10, Node 16 / AngularJS stack. Stores the CLA as a Gist and signatures in MongoDB. Cannot invalidate or re-sign a signature (issue #380), and re-prompts on *any* Gist edit.
- **contributor-assistant/github-action**: archived 2026-03-23. Stores signatures as JSON in a repo branch. No CLA version or text hash recorded.
- **EasyCLA** (Linux Foundation): active, but a heavyweight AWS/DocuSign platform built for LF projects.

## Decisions

| Decision | Why |
|---|---|
| TypeScript `~6.0.x`, not 7 | TS 7.0 (native Go) ships no classic compiler API; 7.1 adds a different one. typescript-eslint 8.72 peers `typescript <6.1`, and Stryker's typescript-checker, `type-coverage --strict` and `check-code-caps.ts` all need the classic JS API. Revisit when those tools support the new API |
| Kysely, not Drizzle | Drizzle 1.0 is still release-candidate (breaking changes pending); Kysely 0.29 is stable and pg-boss ships a Kysely adapter. The schema types are written by hand and a test compares them with the live catalog, so drift fails the build. The tests use a small own PGlite dialect (`kysely-pglite-dialect` sends every statement through the extended protocol, which rejects multi-statement migrations) |
| PGlite for the gated test suite, real Postgres 18 in CI | Fast and hook-friendly; CI re-runs the same suite against a real Postgres 18 container started by `scripts/ci/postgres.ts` |
| CI on the maintainer's shared self-hosted runners, the fork-PR approval gate as the only protection | Maintainer decision, 2026-11-01. Approved fork code runs as the runner user on a host shared with other repositories, and a `runs-on` expression is no boundary because the workflow file comes from the PR. Approval is `all_external_contributors`; the maintainer reads the whole diff first. `release.yml` and `scorecard.yml` stay on GitHub-hosted `ubuntu-24.04`. See [`docs/ci-runners.md`](ci-runners.md) |
| Random free loopback ports, never well-known ones | Any port CI, compose, scripts or tests need is random, free at the time of use, between 32769 and 60999, bound to `127.0.0.1`; `yarn dev` and every test that listens pick one. The one exception is the application's own default `PORT` (3000, the deployment setting of `yarn start`), recorded in `docs/ci-runners.md`. Shared hosts have 5432 taken; Docker's own assignment is sequential, so not enough |
| Check Runs, not commit statuses | Pinnable to the app, richer output, built-in Re-run button |
| `SameSite=Lax` session cookie | Contributors arrive from a cross-site link (the PR comment) and must be recognised on first navigation; compensated by CSRF token and `Origin` check. Deviates from RFC 10017's `Strict` suggestion |
| Code-based TanStack routing | No generated `routeTree.gen.ts` to exclude from every gate |
| `radix-ui` primitives, not shadcn copy-in | Copied components would count toward coverage, caps and FTA |
| React Compiler off in v0 | `@vitejs/plugin-react` 6 needs `@rolldown/plugin-babel` with a peer-range mismatch; lint rules for it are still enabled via `eslint-plugin-react-hooks` |
| `as` assertions need the same written reason as `any` | Hard rule 3 lists them as escape hatches, and `type-coverage --strict` penalises them. `yarn lint:hatches` requires a comment with ` -- <reason>` on the same line or alone on the line above; the coverage-ignore form is `/* v8 ignore next -- @preserve <reason> */` |
| Gate tools join as informative CI jobs, then become required one at a time | A job that has never run on the shared runners could block every merge. E20 wires `semgrep`, `trivy`, `postgres`, `mutation`, `e2e`, `leaks` and `qodana`; the promotion of the first six to required checks follows a stability definition and a template (E20-S09, [`CONTRIBUTING.md`](../CONTRIBUTING.md), Repository protection). `leaks` and `qodana` are never required |
| `.trivyignore` accepts CVE-2026-102990 until 2027-01-15 | `basic-ftp` 5.3.1 is a dev-only dependency of `memlab` (memlab, puppeteer, proxy-agent, get-uri, basic-ftp). It parses FTP directory listings, which only a PAC proxy script fetching over `ftp:` would reach; the leak scenarios load loopback fixtures and configure no proxy. `get-uri` still asks for `^5`, so only a new `puppeteer` release fixes it: remove the entry then. The `memlab` CLI package stays only through `ignoreDependencies` in `knip.json` |
| No user tokens stored | Least privilege and liability; identity is read once at login |
| `octokit` 5.0.5 for the GitHub client | MIT and ESM-only (transitive licences MIT, ISC, Apache-2.0), AGPLv3-compatible. Its retry plugin is registered with `retries: 0` and its throttling plugin is disabled: our own limiter decides (per installation, which the plugin cannot do). The `User-Agent` is `cla-gate/<package.json version>`, `0.0.0` until the maintainer sets releases |
| A rate-limit 403 is an outage, never "forbidden" or "removed" | A caller that reads 403 as "no access" (a repository that left the installation) would take a limit for a removal. The limiter waits out up to 60 s twice, then `GitHubRateLimitedError` goes to the job layer (E07-S03) |
| The token mint is a POST and the client does not repeat it by itself; tokens are never persisted | Only GETs are repeated (1 s, then 2 s); the mint goes through the rate limiter as a write and is repeated after a short limit only. A restart mints again on first use |
| The App owner is always served; admission is keyed on the numeric account id; no wildcard | `GITHUB_ALLOWED_ACCOUNT_IDS` is a finite list, so opening an instance to every account cannot be expressed. Admitting is audited as `installation.admitted` so every state change has an audit row. An account that is neither a user nor an organisation (read as type `Other`) is recorded as rejected whatever its id: ids of different kinds of account are no promise about each other |
| The installation sync runs in two transactions with the list fetched between | The stored gate reads through a pool of 10 connections, so holding a transaction across an HTTP call could starve it. A sync that writes nothing changes nothing, not even `last_synced_at` |
| Self-hosted only, one instance per server, multi-org | Any developer runs it on their own server with one GitHub App; that instance serves several GitHub orgs, each org being a tenant keyed by its GitHub installation id. An instance-level admission policy decides which orgs may use the server. No hosted SaaS and no published container image: operators build the image from the checkout |

## Open questions

Resolved: self-hosted only (one instance per server, serving several orgs, no hosted SaaS, no published image), corporate CLA is not in the MVP (epic E21), hosting target and region are the operator's choice (the operator is the data controller).

- AGPLv3 "only" or "or later"? `AGPL-3.0-only` is assumed. GitNexus (dev tooling) is PolyForm Noncommercial, which matters if this becomes a commercial product.
- Is a Qodana licence and token available? Yes (answered 2026-11-02): an Ultimate Plus licence, a Qodana Cloud project and the secret `QODANA_TOKEN`. The `qodana` job runs on GitHub-hosted `ubuntu-24.04`, passes after the 13 findings of its first scan were fixed, and stays a check that is never required (epic E20, E20-S08).
- Legal: e-signature validity (ESIGN, eIDAS) and GDPR retention choices need counsel; this repo contains no legal advice.
