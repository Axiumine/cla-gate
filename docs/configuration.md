# Configuration

Environment variables of the server and what the foundation guarantees. The code that reads them is `src/server/config/` (`env-fields.ts`, `env-schema.ts`, `env.ts`); the start-up order is in [`architecture.md`](architecture.md) (Rules).

The server reads only environment variables, validates them with zod at start-up, and exits with the NAMES of the invalid variables (never a value). An empty variable counts as unset. No dotenv file is read.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production`. Production requires an `https://` `PUBLIC_BASE_URL` |
| `HOST` | `127.0.0.1` | Interface to listen on. Containers set `0.0.0.0` |
| `PORT` | `3000` | TCP port, 0 to 65535. `yarn dev` sets a random free one above 32768 unless you set it |
| `LOG_LEVEL` | `info` | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `DATABASE_URL` | none, required | `postgres://` connection string of the unprivileged runtime role `cla_app`. A secret: it is masked in logs and errors |
| `MIGRATION_DATABASE_URL` | falls back to `DATABASE_URL`, except in production where it is required | Owner connection used by `yarn db:migrate` only; the app never reads it. Tables created by the runtime role would be owned by it, and an owner can disable the immutability triggers |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>` | Origin the public reaches the app on (no path); required, as `https://`, in production |
| `TRUST_PROXY` | `false` | `true`, `false`, a hop count (`1`), or a comma separated list of IPs and CIDRs of trusted proxies. A typo is a start-up error, so it never silently trusts every proxy. Set it correctly behind a load balancer or every client looks like the proxy |
| `SESSION_SECRET` | none | At least 32 characters. Optional until sessions land |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | none | Placeholders: validated when set, required by the GitHub App slice |

What the foundation guarantees: every response carries a strict CSP and the other helmet headers (HSTS only for `https://` origins); every request gets an `x-request-id` (a well-formed incoming one is kept, otherwise a UUID) that appears in the log lines and in the error body; error bodies are `{ "error": { "code", "message", "requestId" } }` with the standard status text, so an exception message never reaches a client, and that holds for failures that never reach a route too (an invalid URL escape, an over-long parameter, garbage on the socket, oversized headers: Fastify's `frameworkErrors` and `clientErrorHandler` answer them with the same body, the request id and the same security headers); logs never hold headers, cookies, query strings, bodies or secrets. The HTTP server has explicit limits (`adapters/http/limits.ts`): 30 s for a silent socket and for a whole request, 10 s for the headers, a 65 s keep-alive, 1000 requests per connection and a 1 MiB body (a route that needs more, such as the webhook, raises it for itself). SIGINT and SIGTERM drain in-flight requests, but after 10 s (`shutdownTimeoutMs`) the open connections are dropped and the exit code is 1; a second signal does it at once. `GET /healthz` is liveness (touches nothing), `GET /readyz` is readiness (the database answers `select 1` within two seconds, else `503 {"status":"unavailable"}`). The client address is neither logged nor stored (network metadata stays off unless a configuration flag asks for it).
