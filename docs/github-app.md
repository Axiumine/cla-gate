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
- User tokens (`ghu_`) expire in 8 h and refresh tokens are single-use. We do not store them: the login uses a user token once, at the callback, and revokes it, so the App's expiring-token setting does not matter (refresh fields in the answer are parsed and dropped).
- The App's **Callback URL** must be `callbackUrl(config)` (`src/server/config/auth.ts`), that is `PUBLIC_BASE_URL` plus `/api/auth/callback`; the login sends the same value as `redirect_uri`, and the setup kit (E19) reuses the function. The login requests no scopes: a GitHub App's permissions come from the App.
- Installation tokens: 1 h. App JWT: max 10 min; ours is RS256 with `iss` the App id as a string, `iat` now minus 60 s and `exp` now plus 540 s, reused for under 5 min. The mint (`POST /app/installations/{id}/access_tokens`) sends no body, so the token has the installation's full permissions; a 403 whose message says suspended maps to `InstallationSuspendedError` (verify the wording on a real suspended installation).
- Rate limits are handled by the platform's limiter (E05-S05), per installation: a 429, or a 403 with `retry-after` or `x-ratelimit-remaining: 0`, waits up to 60 s (twice); a longer wait raises `GitHubRateLimitedError { retryAfterSeconds, scope }` for the job layer. At most 10 requests are in flight per installation and 50 overall (GitHub allows 100), writes (the token mint included) start at least 1 s apart per installation, and a bucket of 900 points a minute per lane charges 1 for a read and 5 for a write.
- A check and a commit status with the same name must both pass; we only create Check Runs. CLA Assistant posts a legacy status with context `license/cla`: repos migrating from it must disable it first, or use a distinct check name.
- Checks must be reported on the latest head SHA. "Re-run all checks" sends `check_suite.rerequested`, a single re-run sends `check_run.rerequested`: handle both (Checks: write covers them).
- Webhook settings: the URL is `<PUBLIC_BASE_URL>/webhooks/github`, the content type must be `application/json` (form-encoded gives `415 webhook_unsupported_media_type`), and the secret is `GITHUB_WEBHOOK_SECRET` (rotate it by setting the new one, keeping the old one as `GITHUB_WEBHOOK_SECRET_PREVIOUS` until `webhook.secret_previous_used` stops). A delivery naming another App through `X-GitHub-Hook-Installation-Target-ID` or `-Type` gives `400 webhook_wrong_app`. The `Events` row above is the source of `SUBSCRIBED_EVENTS`: `webhook-events-docs.test.ts` parses it (event names in backticks), so keep that format.
- Webhook answers: `200 {status:'pong'}` for `ping`; `202 {status:'accepted'}` for a recorded delivery and `200 {status:'duplicate'}` for one recorded before; `202 {status:'ignored', reason}` for a delivery that starts no job, with the reasons of the routing table plus `installation_not_admitted`, `installation_deleted`, `installation_suspended`, `installation_unknown` and `repository_installation_mismatch` (the last two also start a `sync-installation` job); `429 webhook_throttled` and `503 webhook_timeout` (8 s deadline). Until the queue exists (E07-S01) a delivery that starts a job gets `503 webhook_enqueue_failed`.
- Roles (E11) are read with the installation token and numeric ids: `GET /orgs/{org}/memberships/{username}` (Members: read) and `GET /repos/{owner}/{repo}/collaborators/{username}/permission` (Metadata: read). A 403 that is a rate limit (`retry-after` or `x-ratelimit-remaining: 0`) is a rate limit; any other 403 is a missing permission, logged as `members_permission_missing` or `repository_permission_missing` with the numeric installation id, and resolves as not admin. The public-members endpoints are never used. A renamed repository or login answers 404 and fails closed until the next sync or login.
- Supporting PR comments needs only Pull requests: write; `issue_comment` events need Issues: read.
- The App supports multiple private keys: deploy the new key before deleting the old one.
- Start-up checks the identity with `GET /app` (owner id and type, slug, permissions), keeps the owner id for the admission policy and compares the id with `GITHUB_APP_ID`. The slug is also what the public `GET /api/meta` (E17-S09) builds `installUrl` from (`https://github.com/apps/<slug>/installations/new`), read at each request because the check can succeed after the server is listening.
- Recommended visibility: Only on this account. For a public App, the instance admission policy (`GITHUB_ALLOWED_ACCOUNT_IDS`) is the second line; see [`operations.md`](operations.md).
- The sync warns (`installation.permissions_missing`) when an installation's `permissions` object lacks one of the minimum permissions above, by their API keys: `metadata`, `pull_requests`, `checks`, `issues`, `members`. The names follow GitHub's REST documentation and are unverified against a real installation payload.
- The noreply email form (`ID+login@users.noreply.github.com` for accounts created after 2017-07-18, legacy `login@users.noreply.github.com` for older ones, which names no id and is never resolved) was checked against GitHub's documentation on 2026-11-02, and the `web-flow` committer is account id 19864447 (`GET /users/web-flow`, same day); the evaluation engine relies on both (E08-S02, E08-S06).
