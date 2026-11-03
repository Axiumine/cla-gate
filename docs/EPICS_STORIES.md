# Epics and stories

## Purpose

This file is the work queue for the CLA Gate platform. Each epic has one file in [`docs/epics/`](epics/) (`E01.md` to `E23.md`) with its goal, dependencies, out-of-scope list and numbered stories, and every story has acceptance criteria that a reviewer can check. The tables below are the index; the epic files are the source of truth.

The CI runs on shared, self-hosted runners under the policy in [`ci-runners.md`](ci-runners.md) (E23). A story that writes a CI job, a workflow, a container, a port or a test database ends its acceptance criteria with a link to that policy, so the policy is a contract the story must meet.

The files are living documents. When a story is finished, its status (and, if the work changed it, its wording) is updated in the same change as the code, and the header status of the epic follows its stories: all done is Done, all todo is Todo, anything else is In progress. A new story is appended with the next sequential id, ids are never renumbered, and a decision that changes is recorded in the document that owns it (the table in [`CLAUDE.md`](../CLAUDE.md) lists them) in the same change.

**Definition of done for a story:** every acceptance criterion is met, all gates listed under Thresholds in [`docs/quality-gates.md`](quality-gates.md) are green, and the documentation (`README.md`, `CLAUDE.md` and the documents it lists, the epic file and this index) is kept true. CI jobs follow the [CI runners policy](ci-runners.md): shared self-hosted runners, a literal `runs-on`, random free loopback ports, timeouts and cleanup, and the fork pull request approval checklist for anything that comes from a fork.

## Legend

| Status | Meaning |
|---|---|
| ✅ Done | All acceptance criteria met and merged |
| ⏳ In progress | Some stories done, or work started |
| ⬜ Todo | Not started |

| Priority | Meaning |
|---|---|
| 🔴 Must have | Required for the first release |
| 🟠 Should have | Planned for the first release, can slip |
| 🟢 Could have | After the first release |

## Bounded contexts

| ID | Name | Responsibility |
|---|---|---|
| BC-01 | Server foundation | Configuration, database, migrations, immutability triggers, audit writer and the HTTP skeleton. |
| BC-02 | Authentication and authorization | GitHub login, sessions, roles and tenant isolation by installation id. |
| BC-03 | CLA documents and signing | Versioned CLA text, the contributor consent flow, signatures and corporate agreements. |
| BC-04 | Evaluation, jobs and reporting | Pull request evaluation, the job queue, Check Runs and PR comments. |
| BC-05 | GitHub App and webhooks | The single GitHub App of the instance, installations as tenants, webhook intake. |
| BC-06 | Maintainer and web | The React application, maintainer administration of repositories, allowlists and overrides. |
| BC-07 | Compliance and audit | Audit trail, exports, erasure of personal data and retention. |
| BC-08 | Quality and governance | Repository governance, licence, toolchain, gates, CI and the CI runner policy. |
| BC-09 | Self-hosting | Container image, compose stack, provisioning, first-run setup and operator documentation. |

## Epic overview

The platform is self-hosted only: one instance per server with one GitHub App, serving several GitHub organisations or accounts. Each organisation is a separate installation of the App and a tenant isolated by its installation id, and an instance-level admission policy decides which organisations may use the server.

| ID | Epic | Bounded Context | Priority | Status | Stories | File |
|---|---|---|---|---|---|---|
| E01 | Repository governance and licensing | BC-08 | 🔴 Must have | ✅ Done | 6 | [E01.md](epics/E01.md) |
| E02 | Quality-gate toolchain and CI | BC-08 | 🔴 Must have | ✅ Done | 8 | [E02.md](epics/E02.md) |
| E03 | Structure-cap ratchet tool | BC-08 | 🟠 Should have | ✅ Done | 7 | [E03.md](epics/E03.md) |
| E04 | Server foundation | BC-01 | 🔴 Must have | ✅ Done | 9 | [E04.md](epics/E04.md) |
| E05 | GitHub App core | BC-05 | 🔴 Must have | ⏳ In progress | 9 | [E05.md](epics/E05.md) |
| E06 | Webhook intake | BC-05 | 🔴 Must have | ✅ Done | 7 | [E06.md](epics/E06.md) |
| E07 | Job queue, concurrency and reconciliation | BC-04 | 🔴 Must have | ✅ Done | 10 | [E07.md](epics/E07.md) |
| E08 | PR evaluation engine | BC-04 | 🔴 Must have | ✅ Done | 8 | [E08.md](epics/E08.md) |
| E09 | Check Run and PR comment reporting | BC-04 | 🔴 Must have | ⬜ Todo | 9 | [E09.md](epics/E09.md) |
| E10 | Authentication and sessions | BC-02 | 🔴 Must have | ⏳ In progress | 8 | [E10.md](epics/E10.md) |
| E11 | Authorization and tenant isolation | BC-02 | 🔴 Must have | ✅ Done | 8 | [E11.md](epics/E11.md) |
| E12 | CLA documents and versions | BC-03 | 🔴 Must have | ⬜ Todo | 7 | [E12.md](epics/E12.md) |
| E13 | Contributor signing flow | BC-03 | 🔴 Must have | ⬜ Todo | 7 | [E13.md](epics/E13.md) |
| E14 | Repository enablement and allowlist | BC-06 | 🔴 Must have | ⬜ Todo | 7 | [E14.md](epics/E14.md) |
| E15 | Revocation, overrides and pending PRs | BC-06 | 🟠 Should have | ⬜ Todo | 7 | [E15.md](epics/E15.md) |
| E16 | Compliance, audit and data protection | BC-07 | 🔴 Must have | ⬜ Todo | 7 | [E16.md](epics/E16.md) |
| E17 | Web application shell and design system | BC-06 | 🔴 Must have | ✅ Done | 11 | [E17.md](epics/E17.md) |
| E18 | Contributor and maintainer screens | BC-03 / BC-06 | 🔴 Must have | ⬜ Todo | 14 | [E18.md](epics/E18.md) |
| E19 | Self-hosting kit | BC-09 | 🔴 Must have | ⬜ Todo | 12 | [E19.md](epics/E19.md) |
| E20 | Extended quality gates | BC-08 | 🟠 Should have | ⏳ In progress | 16 | [E20.md](epics/E20.md) |
| E21 | Corporate CLA (later) | BC-03 | 🟢 Could have | ⬜ Todo | 5 | [E21.md](epics/E21.md) |
| E22 | Merge queue, badge and public verification (later) | BC-04 / BC-03 | 🟢 Could have | ⬜ Todo | 5 | [E22.md](epics/E22.md) |
| E23 | Self-hosted CI runners | BC-08 | 🔴 Must have | ⏳ In progress | 11 | [E23.md](epics/E23.md) |

## Progress summary

| Status | Stories | Epics |
|---|---|---|
| ✅ Done | 107 | 9 |
| ⏳ In progress | 5 | 4 |
| ⬜ Todo | 86 | 10 |
| Total | 198 | 23 |

## Dependency and sequencing

The waves below come from the Depends on lines of the epic files (a wave is the longest dependency chain below an epic, and the graph has no cycle). Epics in one wave can be built in parallel once the earlier waves they depend on are merged.

| Wave | Epics | Depends on |
|---|---|---|
| 1 | E01 | none |
| 2 | E02 | E01 |
| 3 | E03, E04 | E02 |
| 4 | E05, E08, E23 | E02, E04 |
| 5 | E06, E10, E20 | E02, E04, E05, E23 |
| 6 | E07, E11, E17 | E04, E05, E06, E10, E23 |
| 7 | E09, E12, E16, E19 | E04, E05, E07, E08, E11, E17, E23 |
| 8 | E13, E14 | E09, E10, E11, E12 |
| 9 | E15, E22 | E09, E11, E13 |
| 10 | E18, E21 | E12, E13, E14, E15, E16, E17 |

### Story-level prerequisites

The Depends lines are epic-wide. These stories must also be merged before the stories that use them, either because no Depends line (direct or through another epic) says so, or because the order inside one epic differs from the numbering. Each epic file repeats the ones that concern it.

| Merge first | Before | Why |
|---|---|---|
| E06-S01 | E10-S03, E19-S06 | Defines `WEBHOOK_PATH`, the shared route constants and `AppError`. |
| E07-S03 | E10-S07 | The handler registry, the job-payload schemas and the delivery wrapper must exist before the `revoke-user-sessions` handler is bound (E10 is wave 5 and E07 wave 6, which no Depends line says); E07-S03 binds the E10-S07 handler when it lands. |
| E07-S09 | E12-S04, E14-S02, E14-S03, E14-S04, E14-S06 | The `sweep-repository` and `finalise-*` jobs are the one re-evaluation mechanism for policy changes. |
| E08-S01 | E07-S04 | E07 builds the facts and calls the evaluator, so the evaluation types come first (E07 needs E08, which no Depends line says). |
| E09-S01 | E10-S03, E12-S01, E16-S03, E16-S06, E17-S06, E17-S11 | The single shared hostile-name corpus and the escaping rules. |
| E09-S06 | E14-S04 | The reporter method that completes the Check Run as neutral when enforcement is turned off. |
| E11-S01 | E17-S09, E19-S06 | `PUBLIC_ROUTES` and the route-access declarations that later public routes join. |
| E13-S05 | E16-S05, E16-S06 | The network-metadata columns that the retention job purges and the export reads. |
| E14-S01 | E15-S05, E15-S06 | The repository-action rule that the override endpoints reuse. |
| E16-S04 | E21-S01, E22-S05 | The three-argument `erase_signer_pii` function. |
| E20-S06 | E18-S12 | The Playwright harness and the pinned container. |
| E20-S07 | E18-S12 | The memlab wrapper that runs the leak scenarios. |
| E19-S08 | E20-S15 | The `container` job must exist before it is promoted to a required check. |
| E17-S11 | E17-S10 | `UserText` before the data primitives that render user text. |
| E19-S08 | E19-S12 | The smoke harness before its extra scenarios. |
| E19-S09 | E19-S10 | The operator guides before the documentation updates that link them. |
| E19-S11 | E19-S07 | The conversion endpoint before the setup page that calls it. |
