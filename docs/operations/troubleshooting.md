# Troubleshooting

Each entry is a symptom, its cause and the fix. Start with the same four commands every time; they answer most questions:

```sh
docker compose --profile tls ps -a        # what runs, what exited and with which code
docker compose logs --tail 100 app        # the last lines of the server; migrate, postgres and caddy likewise
curl -s https://cla.example.com/readyz    # {"status":"ready"} or {"status":"unavailable"}
curl -s https://cla.example.com/api/meta  # the commit that runs
```

Commands that re-create `app` are written here without the prefix `SOURCE_COMMIT=$(git rev-parse HEAD)` that [install.md](install.md#why-source_commit) explains; add it. The server logs one JSON line per event to the container's output. It never logs a secret, a request body, an email or a client address. Every error answer carries a `requestId`, which is also in the log lines of that request: `docker compose logs app | grep <requestId>`.

## The server stops at start-up with a configuration error

**Symptom.** `app` is `Restarting` or `exited (1)`, and `docker compose logs app` has plain-text lines, one for each invalid setting, in the form `VARIABLE: <the rule that failed>`:

```text
PUBLIC_BASE_URL: must be an origin such as https://cla.example.com (scheme and host only); https is required when NODE_ENV=production
SETUP_TOKEN: required while no GitHub App is configured; set it, or set the GITHUB_* variables
GITHUB_CLIENT_SECRET: required: some GitHub App variables are set, so all five are needed (or none, for setup mode)
GITHUB_APP_PRIVATE_KEY_FILE: cannot read /run/secrets/github_app_private_key (ENOENT)
SESSION_SECRET, SESSION_SECRET_FILE: set only one
```

**Cause.** The server validates everything before it opens a port and reports all problems at once. The message names the variable and the rule and never the value. The usual ones: `PUBLIC_BASE_URL` is not an `https://` origin or has a path; some but not all of the five GitHub values are set (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) after the setup, because one file or one `.env` line is still empty; a `*_FILE` variable names a file that is missing, unreadable or larger than 64 KiB; a secret was given both directly and as a file.

**Fix.** Change the named setting. A line of `.env` needs `docker compose up -d` to take effect, a file in `secrets/` needs `docker compose restart app` ([install.md](install.md#settings-and-secrets-change-differently)). The container restarts by itself every few seconds until the settings are valid.

A different line, `database: cannot connect (ECONNREFUSED); check DATABASE_URL and that the database is up`, comes after five tries two seconds apart. The code in brackets is the driver's (`ECONNREFUSED`: the database is not up or not on that address; `28P01`: the password is wrong; `3D000`: no such database). Look at `docker compose ps postgres` and at `secrets/database_url`, and see the next entry for a password the database does not know.

## `migrate` fails

**Symptom.** `docker compose up` ends with `dependency failed to start: container ...-migrate-1 exited (1)`, and `app` never starts. `docker compose logs migrate` has a line that starts with `migration failed:`.

**Cause and fix.** The messages about the migration history (`was edited after it was applied`, `is missing from the migrations directory`, `is older than the applied migration`) and about the job queues are explained in [upgrade.md](upgrade.md#when-migrate-refuses). On a first installation the commonest cause is a password: `password authentication failed for user "cla_owner"`. The provisioning script creates the roles only when the database volume is new, with the passwords in `secrets/` at that moment. If you started once, deleted or regenerated `secrets/` and started again, the files and the database no longer agree. If there is nothing in the database yet, start over cleanly with `docker compose down -v` and `up`. If there is data, set the passwords in the database from the files as [key-rotation.md](key-rotation.md#database-role-passwords-database_url-migration_database_url) shows. `ECONNREFUSED` means `postgres` is not healthy yet or not up: `docker compose logs postgres`.

## `/readyz` answers 503

**Symptom.** `curl /readyz` returns `503` and `{"status":"unavailable"}`, while `/healthz` stays `200` and the container stays up. Load balancers use `/readyz`; Docker's own health check uses `/healthz` on purpose, so that a database outage does not make Docker restart a healthy server.

**Cause.** `/readyz` is 200 only when the database answers `select 1` and the job queue is started with every declared queue present, each within two seconds. Any of these makes it 503: the database is down, restarting or unreachable (the container `postgres` is not healthy, or `secrets/database_url` has the wrong password); the queues were never created (`migrate` did not run, or ran an older version); pg-boss reported an error.

**Fix.** `docker compose ps -a` shows which container is not healthy. `docker compose logs postgres app migrate` shows why. Bring the database back, run `docker compose run --rm migrate` if the queues are missing, and `/readyz` returns to 200 within seconds of the database answering.

## People sign in at GitHub and are asked to sign in again

**Symptom.** The sign-in goes through GitHub and returns, and the platform still shows the sign-in page, or a page says the login failed. The browser's developer tools show the cookie `__Host-cla_session` refused or missing.

**Cause.** The session cookie and the cookie that carries a sign-in attempt are `Secure` and their names start with `__Host-`, which a browser accepts only on an HTTPS page (and on `http://localhost`). So they are lost when the site is opened over plain `http://`, behind a proxy that terminates TLS but lets people use an `http://` address, or under a host name or IP address other than the one in `PUBLIC_BASE_URL`. A second cause is the App's Callback URL on GitHub: it must be `PUBLIC_BASE_URL` plus `/api/auth/callback`, otherwise GitHub says the `redirect_uri` is not associated with the App. A third: every change request carries an `Origin` that must equal `PUBLIC_BASE_URL`, and one from another address is refused.

**Fix.** Use the address in `PUBLIC_BASE_URL`, always over HTTPS; make the proxy redirect port 80 to it ([reverse-proxy.md](reverse-proxy.md)). If you moved to another domain, change `PUBLIC_BASE_URL` in `.env`, run `docker compose up -d`, and update the Callback URL, the webhook URL and the setup URL in the App's settings on GitHub.

## Deliveries fail in GitHub's "Recent Deliveries"

**Symptom.** On GitHub, the App's settings, Advanced, Recent Deliveries show red entries, and pull requests are not checked.

**Cause and fix.** Open an entry and read the response. The server answers with a code that names the cause:

| Response | Cause | Fix |
|---|---|---|
| `401 webhook_signature_invalid` | The secret on GitHub is not the one in `secrets/github_webhook_secret` (or the previous one) | Set them equal: [key-rotation.md](key-rotation.md#webhook-secret-github_webhook_secret-github_webhook_secret_previous). Then use "Redeliver" |
| `400 webhook_wrong_app` | The delivery names another App, or `GITHUB_APP_ID` is empty or wrong | `GITHUB_APP_ID` in `.env` must be the id of this App; `docker compose up -d` |
| `415 webhook_unsupported_media_type` | The webhook's content type is `application/x-www-form-urlencoded` | Set it to `application/json` in the App's webhook settings |
| `413 webhook_payload_too_large`, or a 413 with an HTML page | The first is the application's own limit of 10 MiB for a delivery; the second is your proxy's, which nginx sets to 1 MiB unless told otherwise | For the second, `client_max_body_size 25m;` in nginx ([reverse-proxy.md](reverse-proxy.md)). A delivery above 10 MiB is refused on purpose |
| `429 webhook_throttled` | Too many wrong signatures from one address in a short time | Fix the secret; the throttle clears by itself within minutes |
| `503 webhook_enqueue_failed` | The job queue is down or was never created | Look for `webhook.enqueue_failed` in `docker compose logs app`; see the `/readyz` entry above; then redeliver |
| `503 webhook_timeout` | The server could not record the delivery within 8 seconds | The database is slow or blocked; look at `postgres` |
| `202` with `"status":"ignored"` and the reason `installation_not_admitted` | Expected: the organisation is not on the admission list | [install.md](install.md#serving-several-organisations) |
| `404`, a timeout, `502`, `504`, "could not connect", a certificate error | The URL is wrong (it must be `PUBLIC_BASE_URL` plus `/webhooks/github`), DNS or the certificate is wrong, the proxy or the app is down | From outside the server: `curl -i https://cla.example.com/healthz` must answer `200` with a valid certificate. If the App was created while `PUBLIC_BASE_URL` was not `https`, its webhook was created inactive: tick "Active" in the App's settings |

## A check stays "in progress"

**Symptom.** The `license/cla` check of a pull request stays `in_progress` for longer than a few minutes.

**Cause.** The evaluation is a background job. A job that was running when the process died (a restart, an upgrade, a crash) is retried after its 300-second expiry. A job that keeps failing is retried five times (six runs in all), the first retry after 30 seconds and each next one after twice as long, and then ends in the dead-letter queue `job-dead-letter`, whose handler completes the check as `failure` with a hint to comment `/recheck`, so a check is not left open for good. The error line `dead_letter_unhandled` means that the handler itself failed.

**Fix.** Wait five minutes. Then, on the pull request, a maintainer or the author comments a line that is exactly `/recheck`, or presses "Re-run" on the check: both start a new evaluation. Make sure the sweep is on: `SWEEP_INTERVAL_MINUTES` is 30 by default and 0 turns it off. The sweep re-queues an evaluation that has been `in_progress` for more than 30 minutes, so a lost job heals by itself within about an hour at the default. `docker compose logs app` for the time of the pull request shows what failed. If every evaluation fails, look at `/readyz` first, then at `github.rate_limited`, `github.app_keys_refused` and `members_permission_missing`: the first means GitHub's rate limit, the second a key GitHub no longer accepts ([key-rotation.md](key-rotation.md)), the third an App without the Members: read permission.

## Every user is rate limited

**Symptom.** People get `429 too_many_requests` or "Too Many Requests" although they did nothing, mostly at busy hours, or the log has `trust_proxy_suspected`.

**Cause.** The server counts requests per client address. Behind a proxy that `TRUST_PROXY` does not include, every client arrives with the address of the proxy and they all share one budget of 600 requests a minute, and 20 sign-in starts a minute.

**Fix.** Set `TRUST_PROXY` to the proxy's address, and verify with the four steps in [reverse-proxy.md](reverse-proxy.md#verify-the-setting). The compose stack's default is right for the bundled Caddy and for a proxy on the same host.

## The certificate is not issued

**Symptom.** With the `tls` profile, the browser shows a certificate error or a refused connection, and `docker compose --profile tls logs caddy` has lines with `challenge failed`, `no valid A records`, `timeout during connect (likely firewall problem)` or `rateLimited`.

**Cause.** Let's Encrypt must reach the server twice: it resolves the name and then connects to port 80 (or 443). The failures are the name (it does not resolve to this server, or its `AAAA` record points elsewhere), the port (a firewall, a cloud security group, or another program that holds 80 or 443), a `PUBLIC_BASE_URL` that is not an `https://` origin without a path, or the limit on certificates per name and week, which a stack that was torn down with `down -v` several times reaches.

**Fix.** Check the name: `dig +short cla.example.com A AAAA` must show this server only. Check the ports from outside the server and on it: `ss -ltnp | grep -E ':(80|443) '` shows who holds them (if it is not Docker, stop it: Caddy cannot start with `address already in use`). Fix `PUBLIC_BASE_URL` and run `docker compose --profile tls up -d`. Caddy retries by itself with a growing pause, so a corrected name or port works within minutes; a rate limit message says until when to wait. Do not run `down -v` in the meantime: it deletes the certificate that Caddy already has. To test without DNS, use `PUBLIC_BASE_URL=https://localhost` ([reverse-proxy.md](reverse-proxy.md)).

## `/setup` does not work

- `404`: the server is not in setup mode. All five GitHub values are set, which is the normal state after the setup. To create the App again, delete it on GitHub, empty the five values (`GITHUB_APP_ID` and `GITHUB_CLIENT_ID` in `.env`, the three files in `secrets/` with `install -m 0444 /dev/null secrets/<file>`), keep `secrets/setup_token`, and run `docker compose up -d`.
- "Setup token" rejected: copy it from `secrets/setup_token` without the line break. More than five wrong tries in a minute from one address are answered `429` until the minute is over.
- The page says the App was already created, or the code is no longer valid: GitHub's one-time code lives an hour and works once. Start again from `/setup`; if the App exists on GitHub already, delete it there first.
