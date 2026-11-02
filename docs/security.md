# Security, auth and privacy

How users are authenticated and authorised, and the security and privacy rules of the service. The rulebook form of the webhook, cookie, authorization and output-encoding rules is in [`architecture.md`](architecture.md) (Rules); the data that is stored is in [`data-model.md`](data-model.md); the GitHub App permissions are in [`github-app.md`](github-app.md).

## Auth model

Backend-for-frontend: the SPA never holds tokens. Login uses GitHub App user authorization with a short-lived `Lax` state cookie and PKCE. The API reads the identity and verified emails, rotates to a **new** session id, and issues a server-side session (Postgres) in a `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie with idle and absolute expiry. The session cookie is `Lax` rather than the `Strict` that RFC 10017 prefers because contributors arrive from a cross-site link (the sign link in the PR comment) and must be recognised on that first navigation; the deviation is compensated by a CSRF token plus `Origin` check on every state-changing request (the webhook route is exempt and relies on its HMAC). `return_to` accepts relative paths only, nothing mutates on GET, and sessions are deleted on a `github_app_authorization` revoke event.

Authorization is derived from GitHub with the **installation token** and numeric ids (org role via the memberships API, repo permission via the collaborators permission API), cached with a short TTL.

| Action | Required role |
|---|---|
| View signatures, export CSV, revoke, invalidate (installation-scoped CLA) | org admin of the installation |
| Same, repo-scoped CLA | repo admin |
| Publish CLA version, edit allowlist, record override | same as above |
| Sign a CLA, view own signatures | any authenticated GitHub user |

Every query is filtered by installation id and covered by cross-tenant tests. Uninstall and repo transfer are handled explicitly (suspend, then retain signatures).

## Security and privacy

- Webhook: HMAC-SHA256 over the **raw body** (`fastify-raw-body`), compared with `crypto.timingSafeEqual`; reject before parsing. Insert the `webhook_deliveries` row and enqueue the job in **one transaction**, and dedupe on `processed_at`, so a crash between the two cannot lose an event while GitHub's redelivery is deduped away. `X-GitHub-Delivery` is unsigned, so jobs re-fetch state instead of trusting payloads. A scheduled reconciliation sweep re-evaluates open PRs to cover missed deliveries. Two webhook secrets are accepted during rotation.
- Concurrency: one evaluation at a time per (repo, PR) without dropping newer work. The job reads the current head SHA at run time and re-checks it before writing the Check Run and comment, and reads signatures last, so a stale job cannot overwrite a newer result.
- Output encoding: names, logins and emails are user-controlled. CSV export prefixes cells starting with `=`, `+`, `-`, `@`, tab or CR to stop formula injection. PR comments and check summaries escape markdown, put names in code spans and neutralise `@` and `#`. Hostile-name tests (including a `toMatchFileSnapshot` CSV case) are mandatory.
- App private key, webhook secret and client secret come from the environment or a secret manager, never the repo. Trivy secret scan (pre-commit) and Semgrep `p/secrets` (pre-push, CI) guard this.
- Parameterised queries only (Kysely); zod validation at every boundary; strict CSP via helmet; no `dangerouslySetInnerHTML`.
- CLA text is rendered from markdown with an HTML-sanitising pipeline; stored hash is over the canonical source text.
- Identity is the numeric GitHub id. Logins and emails are snapshots.
- Data minimisation: identity and verified email only; request nothing else from signers.
- `@fastify/rate-limit` defaults to an in-memory store; a multi-instance deploy needs a shared store (Postgres or Redis). Set `trustProxy` correctly behind a load balancer or limits key on the proxy's IP.
