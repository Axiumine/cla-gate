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

Gotchas worth remembering: the required check must have reported within 7 days to be selectable; passing conclusions are `success`, `skipped`, `neutral`; webhook response budget is 10 s so handlers only verify, dedupe and enqueue; installation tokens give 5,000 requests/hour (more on larger installs) so every request goes through the platform's own rate limiter (below), which honours `retry-after`.

## Rules

- Minimum permissions are in the table above. Do not add permissions without a reason recorded in that table.
- User tokens (`ghu_`) expire in 8 h and refresh tokens are single-use. We do not store them.
- Installation tokens: 1 h. App JWT: max 10 min; ours is RS256 with `iss` the App id as a string, `iat` now minus 60 s and `exp` now plus 540 s, reused for under 5 min. The mint (`POST /app/installations/{id}/access_tokens`) sends no body, so the token has the installation's full permissions; a 403 whose message says suspended maps to `InstallationSuspendedError` (verify the wording on a real suspended installation).
- Rate limits are handled by the platform's limiter (E05-S05), per installation: a 429, or a 403 with `retry-after` or `x-ratelimit-remaining: 0`, waits up to 60 s (twice); a longer wait raises `GitHubRateLimitedError { retryAfterSeconds, scope }` for the job layer. At most 10 requests are in flight per installation and 50 overall (GitHub allows 100), writes (the token mint included) start at least 1 s apart per installation, and a bucket of 900 points a minute per lane charges 1 for a read and 5 for a write.
- A check and a commit status with the same name must both pass; we only create Check Runs. CLA Assistant posts a legacy status with context `license/cla`: repos migrating from it must disable it first, or use a distinct check name.
- Checks must be reported on the latest head SHA. "Re-run all checks" sends `check_suite.rerequested`, a single re-run sends `check_run.rerequested`: handle both (Checks: write covers them).
- Supporting PR comments needs only Pull requests: write; `issue_comment` events need Issues: read.
- The App supports multiple private keys: deploy the new key before deleting the old one.
- Start-up checks the identity with `GET /app` (owner id and type, slug, permissions), keeps the owner id for the admission policy and compares the id with `GITHUB_APP_ID`.
- Recommended visibility: Only on this account. For a public App, the instance admission policy (`GITHUB_ALLOWED_ACCOUNT_IDS`) is the second line; see [`operations.md`](operations.md).
- The sync warns (`installation.permissions_missing`) when an installation's `permissions` object lacks one of the minimum permissions above, by their API keys: `metadata`, `pull_requests`, `checks`, `issues`, `members`. The names follow GitHub's REST documentation and are unverified against a real installation payload.
- The noreply email form (`ID+login@users.noreply.github.com` for accounts created after 2017-07-18, legacy `login@users.noreply.github.com` for older ones, which names no id and is never resolved) was checked against GitHub's documentation on 2026-11-02, and the `web-flow` committer is account id 19864447 (`GET /users/web-flow`, same day); the evaluation engine relies on both (E08-S02, E08-S06).
