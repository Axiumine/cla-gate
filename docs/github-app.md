# GitHub App

The permissions, events and check name of the GitHub App, and the rules for changing them. A story that changes the permission or event set updates this file in the same change (hard rule 10 in [`CLAUDE.md`](../CLAUDE.md)).

## Settings

| Setting | Value |
|---|---|
| Repository: Metadata | read (implicit) |
| Repository: Pull requests | read and write (list PRs and commits, post the comment) |
| Repository: Checks | write (Check Runs, receive `check_run.rerequested`) |
| Repository: Issues | read (receive `issue_comment` for `/recheck`) |
| Organization: Members | read (private membership for the org-member exemption) |
| Account: Email addresses | read (verified emails at login, user token only) |
| Later: Merge queues | read (`merge_group.checks_requested`) |
| Events | `pull_request` (opened, reopened, synchronize, edited, ready_for_review, closed), `check_run` and `check_suite` (rerequested: single and "Re-run all checks"), `issue_comment` (created only; handled when it is on a PR, the sender is not a Bot, and a line is exactly `/recheck`; rate-limited per PR); `installation`, `installation_repositories` and `github_app_authorization` always arrive |
| Check name | `license/cla`, constant. Renaming breaks required-check rules. CLA Assistant posts a legacy status with the same context, and a same-named check and status must both pass: migrating repos must disable CLA Assistant first (or use a distinct check name for them) |
| Branch protection | Pin the required check to this app (ruleset `integration_id`) |

Gotchas worth remembering: the required check must have reported within 7 days to be selectable; passing conclusions are `success`, `skipped`, `neutral`; webhook response budget is 10 s so handlers only verify, dedupe and enqueue; installation tokens give 5,000 requests/hour (more on larger installs) so use Octokit throttling and honour `retry-after`.

## Rules

- Minimum permissions are in the table above. Do not add permissions without a reason recorded in that table.
- User tokens (`ghu_`) expire in 8 h and refresh tokens are single-use. We do not store them.
- Installation tokens: 1 h. App JWT: max 10 min. Honour `retry-after` on 403/429 (secondary limits: 100 concurrent requests, 900 points/min per endpoint).
- A check and a commit status with the same name must both pass; we only create Check Runs. CLA Assistant posts a legacy status with context `license/cla`: repos migrating from it must disable it first, or use a distinct check name.
- Checks must be reported on the latest head SHA. "Re-run all checks" sends `check_suite.rerequested`, a single re-run sends `check_run.rerequested`: handle both (Checks: write covers them).
- Supporting PR comments needs only Pull requests: write; `issue_comment` events need Issues: read.
- The App supports multiple private keys: deploy the new key before deleting the old one.
- The noreply email form (`ID+login@users.noreply.github.com` for accounts created after 2017-07-18, legacy `login@users.noreply.github.com` for older ones, which names no id and is never resolved) was checked against GitHub's documentation on 2026-11-02, and the `web-flow` committer is account id 19864447 (`GET /users/web-flow`, same day); the evaluation engine relies on both (E08-S02, E08-S06).
