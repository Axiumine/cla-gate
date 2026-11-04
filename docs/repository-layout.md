# Repository layout

Where things live in the repository. [`README.md`](../README.md) is the landing page and has the map of the documents; [`development.md`](development.md) says how to run the code.

Items marked (planned) do not exist yet.

```text
.
├── src/server/                  Fastify app; unit tests co-located as *.test.ts
│   ├── main.ts  migrate.ts  healthcheck.ts
│   │                            process entries (kept logic-free; covered by boot tests); healthcheck.ts is the container's HEALTHCHECK over
│   │                            adapters/http/health-probe.ts; boot-database.ts is the start-up database check (E19-S02)
│   ├── boot.ts  app.ts          start-up and signals; the Fastify instance (buildApp); shutdown.ts and its test
│   ├── boot-app.ts  boot-config.ts  boot-installations.ts  boot-reconcile.ts  boot-services.ts
│   │                            the parts of start-up: logging the configuration, binding the gate once the policies
│   │                            exist, reconciling installations, wiring the services
│   ├── boot-app.ts  boot-queue.ts  boot-jobs.ts
│   │                            start-up of the job queue (E07): building the app on the queue, starting pg-boss and
│   │                            refusing a missing queue, and `jobWorkers` (the handler registry, the `register` option a later
│   │                            epic uses, the `evaluation` option E09 binds)
│   ├── boot-evaluation.ts       binds the Check Run reporter to the evaluation jobs when a GitHub App is configured (E09)
│   ├── check-name-literal.test.ts  legacy-status-doc.test.ts
│   │                            the tests that keep the check name in one constant and the legacy status page linked from the Settings table
│   ├── config/                  environment parsing (zod), Secret, TRUST_PROXY parsing; github-app.ts and github-key.ts
│   │                            (App id and PEM, masked), allowed-accounts.ts (GITHUB_ALLOWED_ACCOUNT_IDS), operator-ids.ts
│   │                            (OPERATOR_GITHUB_IDS), web-root.ts (WEB_ROOT), source-fields.ts (SOURCE_URL, SOURCE_COMMIT), env-github.ts
│   │                            (the GitHub variables and their cross-field rules, webhook secrets included) and
│   │                            github-config.ts (the settings the server reads), auth-fields.ts and auth.ts (login
│   │                            variables, the login settings, `callbackUrl`, the start-up lines), migrate-config.ts
│   │                            (what `yarn db:migrate` needs; apart from env.ts to keep that file under the FTA score cap); E19-S02:
│   │                            secret-files.ts (the `*_FILE` resolver and `SECRET_VARIABLES`), mode.ts and mode-log.ts (setup or normal), env-rules.ts,
│   │                            config-error.ts and config-issue.ts (one `VARIABLE: rule` line per problem)
│   ├── adapters/db/             Kysely over node-postgres, hand-written schema types, migration runner and CLI,
│   │                            transaction and advisory-lock helpers, the branded installation row id,
│   │                            PGlite dialect and test helpers (test only, outside the build; the independent
│   │                            connections of the real-Postgres tests are in real-postgres/test-support.ts and
│   │                            re-exported by test-support.ts); document-lock.ts (the row lock of a document) and violations.ts (the constraint a failed
│   │                            statement broke); tenant-scope.ts (`TenantScope`, `assertRepositoryInTenant`;
│   │                            tenant-fixture/, tenant-registry/, tenant-registry-documents/, -drafts/, -versions/, -listing/, -attach/, -enabled/ and -allowlist/ and tenant-scan/ are test only: the two tenants, the registry of
│   │                            tenant queries and the source scan of the cross-tenant tests); pr-evaluation-links.ts (E09: the `check_run_id` and `comment_id` of `pr_evaluations`; pr-evaluation-links-fixture/ and tenant-links-fixture/ are test only); the session store (sessions.ts with sessions-create,
│   │                            -delete, -model, -read, -row and -touch.ts; sessions-fixture/ is test only) and the
│   │                            user upsert (users.ts); global-setup.ts (the throw-away database of a real-server run) and
│   │                            test-database-guard/ (E19-S10: what the guard refuses, in test-support.ts); provision-database*.test.ts are the
│   │                            real-Postgres tests of scripts/provision-database.sh
│   ├── adapters/jobs/           the pg-boss adapter of the job queue (E07): runtime.ts (start, stop, readiness), boss.ts (the slice
│   │                            of pg-boss the code uses), queues.ts and queue-options.ts (the twelve queues and their bounds),
│   │                            queue-policy.ts and queue-check.ts (a queue of the wrong policy is refused), serialisation.ts (the
│   │                            key of a serialised queue), enqueuer.ts and job-id.ts (`PgBossEnqueuer`, the idempotent job id),
│   │                            pending.ts (`PendingJobs`), workers.ts and rejection-guard.ts (the workers, and what a promise that
│   │                            nobody waits for does to its job), migrate-queues.ts, runtime-grants.ts, index-builds.ts and
│   │                            sweep-schedule.ts (the owner's step of `yarn db:migrate`, the grants, the sweep's cron); test-support.ts
│   │                            and the *-real.test.ts suites need the real database
│   ├── adapters/github/         the Octokit adapter of the GitHub port (octokit-*.ts: client, requests, errors, auth; the pull
│   │                            request, comment and open-pull-request calls in octokit-pull-*.ts and octokit-comment-calls.ts, the
│   │                            names the Octokit calls log under in octokit-names.ts; the Check Run calls in octokit-check-runs.ts, octokit-check-reads.ts and octokit-check-writes.ts; check-world/ and http-bodies/ are test only),
│   │                            the App JWT (app-jwt.ts, app-auth.ts), the installation token provider
│   │                            (installation-tokens.ts, token-cache.ts, single-flight.ts), the self-check
│   │                            (app-identity.ts, start.ts), the rate limiter (rate-limiter.ts with lane, semaphore,
│   │                            point-bucket, wait-policy, rate-limit-reading.ts and rate-limit-log.ts), response
│   │                            schemas (schemas.ts), pagination; the login's calls to GitHub with the user's token
│   │                            (user-login*.ts: exchange, identity, addresses, revoke); membership-fixture/ and
│   │                            permission-fixture/ (test only: the contract fixtures of the two role calls), exemption-fixture/ and
│   │                            public-members-guard/ (test only: the typed membership fixtures, and the guard that fails a test
│   │                            that asks a public-members endpoint); E14: octokit-user-accounts.ts (`GET /users/{login}`) and user-account-schema.ts,
│   │                            the members probe in the Octokit client, and members-probe-fixture/ (the fixtures and the MSW route
│   │                            `membersProbeRoute`) and user-account-fixture/ (test only)
│   ├── adapters/github/webhook-schemas.ts  zod schemas of the subscribed events (webhook-fixture/ holds the test payloads)
│   ├── adapters/github/manifest-conversion.ts  the adapter of the port services/ports/manifest-conversion.ts: GitHub's one-time code
│   │                            for the credentials of the App (E19-S11); domain/app-manifest.ts builds the App manifest (E19-S06)
│   ├── adapters/http/           logger, request ids, security headers, error handling (errors.ts: AppError; also for
│   │                            failures that never reach a route), HTTP limits, health routes, trust-proxy conversion,
│   │                            the /api route-audit guard (audit-routes.ts); the webhook route: webhook-routes.ts (the
│   │                            scope), webhook-signature.ts and webhook-signature-hook.ts (HMAC), webhook-throttle.ts,
│   │                            webhook-envelope.ts (headers, media type, JSON), webhook-payload.ts (schema),
│   │                            webhook-answer.ts (routing and answers), webhook-record.ts (recording), webhook-deadline.ts,
│   │                            webhook-log.ts and webhook-observation.ts (the webhook.received line), webhook-handler.ts;
│   │                            login and sessions: auth.ts (wiring), auth-hooks.ts (session lookup), auth-no-store.ts,
│   │                            auth-request.ts (`request.auth`, `requireAuth`), auth-routes.ts (session), auth-login.ts,
│   │                            auth-callback.ts, auth-logout.ts, session-cookie.ts, oauth-cookie.ts, oauth-attempt.ts; the
│   │                            request guards (request-guards.ts, csrf-token.ts, csrf-routes.ts); rate-limit.ts and
│   │                            trust-proxy-warning.ts; who may call a route: route-access.ts (the table,
│   │                            `RouteAccessError`), route-access-model.ts (the kinds, `PUBLIC_ROUTES`, `declaredAccess`),
│   │                            route-access-problems.ts (`accessProblem`) and route-access-guard.ts (the preHandler), tenant-access.ts
│   │                            (`tenantAccess`, `request.tenant`), tenant-resolvers.ts, tenant-guard.ts, upstream-failure.ts
│   │                            (502, 503 and 429), role-cache-slot.ts, operator-guard.ts and operator-routes.ts; spa.ts (serves the
│   │                            single-page app from WEB_ROOT: the files, the index.html fallback, the cache rules) and meta-routes.ts
│   │                            (`GET /api/meta`); spa-fixture/ is test only; spa-url.ts (the address of a browser path); the first-run setup (E19-S06, S07, S11):
│   │                            setup-routes.ts (status; registers the rest in setup mode), setup-flow-routes.ts, setup-unlock-route.ts,
│   │                            setup-manifest-route.ts, setup-session-route.ts, setup-convert-route.ts, setup-guard.ts (Origin, cookie, CSRF),
│   │                            setup-sessions.ts (in memory), setup-cookie.ts, setup-digest.ts, setup-throttle.ts, setup-route-config.ts;
│   │                            setup-fixture/ and setup-convert-fixture/ are test only; health-probe.ts (the container health check);
│   │                            the CLA documents (E12): document-routes.ts (registers them), document-collection-routes.ts,
│   │                            document-create-route.ts, document-item-routes.ts, document-draft-routes.ts, document-version-routes.ts,
│   │                            document-history-routes.ts, document-resolvers.ts, document-presenters.ts, cursor.ts (the opaque page
│   │                            cursor), request-body.ts (`parseInput`), cla-rule-errors.ts; document-fixture/ is test only;
│   │                            test-support.ts, webhook-table-fixture/, auth-fixture/, login-fixture/, callback-fixture/,
│   │                            tenant-guard-fixture/, cross-tenant-fixture/, cross-tenant-runner/ and cross-tenant-canary/ are test only;
│   │                            E16: audit-log-routes.ts (with audit-log-query.ts), signature-csv-routes.ts (with signature-csv-query.ts and
│   │                            signature-csv-log.ts), erasure-routes.ts (with erasure-request.ts) and data-export-routes.ts; the
│   │                            api-snapshots/ directory (the JSON of the own-data export) and the fixtures audit-route-state/,
│   │                            signature-csv-fixture/, erasure-fixture/ and data-export-fixture/ are test only;
│   │                            E14: installation-routes.ts (`GET /api/installations`), repository-list-routes.ts, repository-cursor.ts,
│   │                            repository-document-routes.ts (attach and detach), repository-enable-routes.ts, repository-disable-routes.ts and
│   │                            repository-switch-route.ts (their shared body), allowlist-entry-routes.ts (add), allowlist-entry-list-routes.ts,
│   │                            allowlist-entry-remove-route.ts, allowlist-entry-resolver.ts, allowlist-entry-presenters.ts and
│   │                            allowlist-entry-cursor.ts; installation-list-fixture/, repository-document-fixture/, repository-enable-fixture/,
│   │                            repository-disable-fixture/, repository-flow-fixture/, allowlist-entry-fixture/, allowlist-list-fixture/ and
│   │                            cross-tenant-prepare/ are test only
│   ├── domain/                  admission.ts (who is served, pure), eligibility.ts (when an installation or repository
│   │                            is evaluated), permissions.ts (the missing-permission check), jobs.ts (the job
│   │                            catalogue), delivery-id.ts, webhook-routing*.ts (the routing table: delivery to job or
│   │                            ignore), webhook-tenant.ts (the tenant and admission verdict), session.ts (session
│   │                            lifetimes), return-to.ts (`safeReturnTo`), github-profile.ts (what is kept of a profile),
│   │                            authz.ts (`decide`, the role decision table), tenant-state.ts (`tenantState`), operator.ts
│   │                            (`isOperator`, `createOperatorPolicy`); audit-cursor.ts (the cursor of the audit viewer), csv.ts (the
│   │                            RFC 4180 encoder with the formula guard), signature-state.ts and network-retention.ts (the cutoff); the job envelopes (job-envelope.ts), the retry bounds (job-retry.ts),
│   │                            recheck.ts (the `/recheck` rules and the rate limit key), sweep.ts and repository-jobs.ts (the
│   │                            coalesce keys and reasons of the sweep and the repository-level jobs); version-number.ts (the next version number of a document);
│   │                            E14: repository-action.ts (`requiredRoleForRepository`, `satisfiesRole`), repository-document-change.ts
│   │                            (`requiredRoleForDocumentChange`) and allowlist-entry.ts (`checkAccountKind`);
│   │                            test-support.ts is test only
│   ├── domain/evaluation/       the PR evaluation engine: pure functions over plain facts (actors, co-authors, unlinked
│   │                            identities, allowlist, signatures, commit listing, `evaluatePullRequest`), `index.ts` is
│   │                            its public surface
│   ├── domain/reporting/        the pure output of E09: encode.ts (`renderName`, `neutraliseText`, `shortSha`, `renderId`: the only way user text,
│   │                            SHAs and ids reach GitHub output) and markup.ts; the Check Run: check-view.ts, check-output.ts, check-output-minimal.ts,
│   │                            output-parts.ts (the 50-entry and 60 000-unit caps), coverage-counts.ts; the failure text: failure-report.ts,
│   │                            failure-sections.ts, failure-people.ts, failure-commits.ts, failure-text.ts, failure-input.ts, display-names.ts
│   │                            (`DisplayNames`); the comment: comment-body.ts; run-report.ts (`runReport`, `sharedView`: the worst-of state of the pull
│   │                            requests that stand at one head SHA); test-support.ts and snapshots/ (the golden files) are test only
│   └── services/                audit.ts (appendAudit, the one public entry), audit-entry.ts (AuditEntry, validation);
│                                ports/ (github.ts, installation-gate.ts, clock.ts, github-errors.ts); the stored
│                                ports/jobs.ts (the JobEnqueuer port; jobs-not-wired.ts is the default that fails closed when no queue is wired;
│                                jobs-fixture/ and jobs-contract/ are test only), ports/reporter.ts (the EvaluationReporter port E09
│                                implements) and ports/installation-unavailable.ts, webhook-deliveries.ts and
│                                webhook-delivery-rows.ts (record and enqueue in one transaction), tenant-filter.ts,
│                                failure-throttle.ts and log-limiter.ts; login.ts (the login callback's transaction),
│                                revoke-user-sessions.ts (the job handler), ports/github-login.ts;
│                                the stored installation gate and admission policies (installation-gate.ts, admission-policies.ts);
│                                the job queue's services (E07), pure of pg-boss: job-registry.ts (`HandlerRegistry`), job-handlers.ts
│                                (`registerHandlers`), job-run.ts (`runJob`: envelope check, logs, delivery marked processed),
│                                evaluate-pr/ (the evaluation protocol around the E08 engine; display-names.ts builds the `DisplayNames` of one report), reporting/ (E09, the `EvaluationReporter` over the Check Runs API: check-run-reporter.ts and create-check-run-reporter.ts, check-run-writer.ts (find, create, patch, recreate), run-lifecycle.ts (started, publish), run-endings.ts (failed, cancelled, disabled), report-write.ts, report-guard.ts, report-options.ts, report-record.ts, report-situation.ts, shared-sha.ts (the pull requests that share a head SHA), comment-upsert.ts, comment-guard.ts, disabled-comment.ts; adapter-world/, rerun-fixture/ and scripted-github/ are test only), close-pr/, recheck/ (`/recheck` and
│                                Re-run), sweep/ (the sweep, its reaper and the policy sweep), dead-letter/ (one handler per job type),
│                                repository-job-enqueue.ts (what E12, E14 and E15 call), org-membership.ts and org-membership-cache.ts
│                                (the exemption lookup and its per-process cache); fake-github/, github-comment-contract/,
│                                github-open-pulls-contract/, github-pull-contract/, fake-check-runs/ and github-check-contract/ (the fake Check Runs API and the contract it shares with the Octokit adapter) and job-run-fixture/ are test only
│                                the installation and repository state (installation-*.ts, repository-*.ts): store,
│                                queries, admission, sync and reconcile, transfer, operator view; roles and tenants (E11): org-admin.ts,
│                                repo-admin.ts, repo-admin-discovery.ts, repo-admin-candidates.ts and probe-budget.ts (the role facts and
│                                the discovery), role-deadline.ts (the 5 s rule), role-cache.ts, role-cache-entries.ts, role-key.ts and role-lookup-context.ts (`isCurrent`),
│                                role-lookups.ts and role-lookup-budget.ts (the cache in front of the lookups, 30 a minute), tenant-queries.ts,
│                                tenant-authorization.ts and tenant-authorizer.ts (the guard's reads and decision), admin-ledger.ts and
│                                admin-ledger-queries.ts (the ledger of org admins), document-placement.ts, operator-policies.ts;
│                                role-fixture/, role-lookups-fixture/, role-table-fixture/ and discovery-fixture/ are test only;
│                                E16: audit-log-queries.ts, signer-erasure.ts (with signer-erasure-errors.ts and signer-erasure-counts.ts), network-metadata-purge.ts (the
│                                handler of the daily purge) and export/ (signature-export*.ts, signature-queries.ts, signature-stream.ts,
│                                signature-rows.ts, signature-filter.ts, own-data*.ts, own-signatures-query.ts and signer-network-columns.ts;
│                                csv-snapshots/ and the fixtures are test only); audit-scan/, audit-conformance/ and audit-log-fixture/ are test only
│                                the CLA documents (E12): cla-documents.ts, cla-document-changes.ts, cla-document-queries.ts, cla-document-writes.ts,
│                                cla-document-rows.ts and cla-document-types.ts; cla-drafts.ts, cla-draft-queries.ts and cla-draft-writes.ts;
│                                cla-publish.ts, cla-publish-checks.ts, cla-publish-source.ts, cla-publish-types.ts, cla-version-queries.ts,
│                                cla-version-rows.ts, cla-version-writes.ts, cla-version-sweeps.ts and cla-enforcing-queries.ts; cla-history.ts,
│                                cla-history-queries.ts and cla-history-rows.ts; cla-content.ts (`prepareClaText`, the hash) and
│                                cla-rule-error.ts; publish-fixture/ is test only
│                                E14: installation-list.ts and installation-roles.ts (the roles a person holds across the instance, on the list's
│                                own lookup budget), map-concurrently.ts, repository-list.ts, repository-list-queries.ts, repository-count-queries.ts,
│                                repository-entry.ts and repository-item.ts; repository-document-attach.ts, repository-document-checks.ts,
│                                repository-document-lock-queries.ts, repository-document-queries.ts and repository-document-record.ts (attach and
│                                detach); repository-switch.ts and repository-switch-types.ts (enable and disable in one transaction),
│                                repository-enablement.ts, repository-enablement-checks.ts, repository-enablement-sweep.ts,
│                                repository-disablement.ts and repository-disablement-finalise.ts; finalise/ (the `finalise-repository` and
│                                `finalise-check` jobs and their handlers), evaluate-pr/enforcement-guard.ts, evaluation-handlers.ts (the handlers of
│                                the delivery-driven jobs, moved out of job-handlers.ts); allowlist-entry-*.ts (create, list, remove, their queries
│                                and types), allowlist-account.ts (the GitHub lookups before the transaction) and allowlist-sweeps.ts;
│                                github-members-probe-contract/ and github-user-account-contract/ (the contract cases), fake-user-accounts/,
│                                allowlist-removal-fixture/ are test only
├── src/shared/                  zod schemas shared by server and web (github-app.ts: the App's permissions and events; setup.ts: the setup
│                                routes, schemas and error codes; health, error body, GithubId, route constants in
│                                routes.ts (WEBHOOK_PATH), the session response in auth.ts, verified-email.ts, the audit
│                                vocabulary in audit.ts and the metadata schema in audit-metadata.ts, the PR evaluation
│                                codes, parts and stored-details schema `pr-evaluation-*.ts`, check.ts (`CHECK_RUN_NAME`, the one place the check name is spelled), sign-link.ts (`signUrl`, `isHttpOrigin`), operator.ts (the operator list); the CLA documents (E12): cla.ts (kinds,
│                                rule codes and statuses, the document schemas), cla-name.ts (the name rules), cla-text.ts (the canonical text),
│                                cla-version.ts and cla-history.ts (publish and history), cla-markdown.ts (the sanitising pipeline), cla-markdown-parse.ts,
│                                cla-markdown-nesting.ts and the line scan cla-markdown-containers.ts, -items.ts, -leaf.ts and -lines.ts,
│                                snapshots/ (the rendered files); the route
│                                descriptors the SPA calls (`defineRoute`): contract.ts, auth-contract.ts, meta.ts (`GET /api/meta`); error-codes.ts
│                                (the codes the SPA can see); hostile-names.ts (the hostile-name corpus, test only); E16: audit-log.ts,
│                                signature-export.ts, erasure.ts and data-export.ts (paths, shapes and limits of the compliance routes); E14: installations.ts,
│                                repository-document.ts, repository-enabled.ts and allowlist.ts (paths, queries and answers))
├── src/web/                     the React 19 SPA (Vite 8, Tailwind CSS 4); built to dist/web and served by the server; tests co-located
│   ├── main.tsx  zod-config.ts  index.html
│   │                            the entry (kept logic-free; zod-config.ts turns off Zod's eval probe and is its first import) and the page
│   ├── App.tsx  providers.tsx  router.tsx  route-access.ts
│   │                            the app, the providers (I18nProvider outermost), the code-based routes and the access each declares (`withAccess`)
│   ├── public/                  files copied as they are to the root of dist/web (favicon.svg)
│   ├── api/                     the typed client over the shared route descriptors: client.ts (`createApiClient`), exchange.ts, request.ts,
│   │                            response.ts, errors.ts (ApiError, ContractError, NetworkError), retry-after.ts, query-client.ts, index.ts;
│   │                            test-support.ts (MSW helpers) is test only
│   ├── auth/                    session.ts (the query ['auth','session']), auth.ts, guard.ts, hooks.ts, navigate.ts, return-to.ts, use-logout.ts,
│   │                            UserMenu, Avatar, LoginLink, LogoutButton, SessionEndedBanner, index.ts
│   ├── i18n/                    messages.ts (the English catalog), translate.ts (`t`, `t.plural`), interpolate.ts, format.ts (`formatUtc`),
│   │                            context.ts, I18nProvider.tsx, Timestamp.tsx, index.ts; test-support.ts is test only
│   ├── layout/                  AppShell (skip link, header, main landmark, live region), PrimaryNav, nav-items.ts, SourceFooter (the AGPL
│   │                            section 13 offer), use-page.ts, use-focus-on-navigation.ts
│   ├── meta/                    meta.ts (the `GET /api/meta` query) and source-link.ts (an https link only)
│   ├── pages/                   LandingPage, LoginFailedPage
│   ├── setup/                   the first-run setup page (E19-S07): SetupPage (unlock, App form, credentials), SetupCallbackPage, SetupGate,
│   │                            setup-api.ts, github-links.ts (only github.com addresses), credential-items.ts, download-file.ts
│   ├── states/                  LoadingState, EmptyState, ErrorState, QueryBoundary, RootErrorBoundary, RouterErrorComponent, NotFoundPage,
│   │                            CrashFallback, RetryButton, RequestId, error-message.ts (`errors.<code>` words only), error-facts.ts,
│   │                            crash-log.ts, use-countdown.ts, use-after.ts, reload-page.ts, index.ts
│   ├── styles/                  tokens.css (design tokens, light and dark), app.css (Tailwind: preflight and utilities only)
│   ├── theme/                   model.ts, storage.ts (the one file that touches Web Storage: `cla.theme`), theme-init.ts (the blocking
│   │                            /theme-init.js), ThemeProvider, ThemeToggle, context.ts, index.ts
│   ├── ui/                      the primitives, the only place that imports radix-ui: Button, Field, TextInput, Textarea, Checkbox, RadioGroup,
│   │                            Select, Tabs, Badge (badge-status.ts), StatusMessage, Heading, Dialog, AlertDialog (AlertDialogActions),
│   │                            DataTable (DataTableHeading, data-table-columns), CursorPager (cursor-trail, use-cursor-trail), overlay.tsx,
│   │                            use-keep-focus, UserText and user-text.ts (the safe text step), field-context, index.ts
│   └── test-support/            test only: render.tsx, router.tsx (`TestRoutes`), app-routes.tsx, routes.ts, server.ts (MSW), session.ts,
│                                location.ts, pager.tsx, a11y.ts (axe), hostile.ts, layout.ts, css.ts, contrast.ts, colour-literals.ts,
│                                theme.ts, tailwind.ts and vitest.setup.ts
├── migrations/                  forward-only SQL, never edited after merge (001 to 005: initial schema, audit metadata allowlist, installation and repository state, account type Other, session verified emails; 007: the ledger of org admins; 008: the evaluation result `cancelled`; 9: `erase_signer_pii` per installation; 10: `purge_signer_network_metadata`; 11: the drafts table `cla_drafts`; 12: `allowlist_entries.login_snapshot`; 13: `erase_signer_pii` reaches an allowlisted account that never signed; the numbers 006 and later go to the epics in order of merge)
├── docker/Caddyfile             the configuration of the optional reverse proxy with automatic TLS (compose profile `tls`, E19-S05)
├── .env.example                 every environment variable with its default or an empty value (env-example.test.ts keeps it complete)
├── docker-compose.yml           the operator stack (E19-S04): postgres, a one-shot migrate and app, and caddy in the profile `tls`; `docker compose up --build`
├── docker-compose.dev.yml       the development database: PostgreSQL 18 on a random free loopback port (POSTGRES_PORT, set by yarn db:up)
├── .dockerignore                what the build context leaves out (secret-bearing files, tool state, e2e, sources of other builds)
├── docs/ci-runners.md           CI runner policy: shared self-hosted runners, fork approval, ports, job rules
├── docs/development.md          status, setup and run, and the package.json scripts (exists or deferred)
├── docs/configuration.md        environment variables and what the server foundation guarantees
├── docs/quality-gates.md        thresholds, TypeScript setup, testing conventions, escape hatches
├── docs/toolchain.md            tool evaluation, hook pipeline, CI job graph
├── docs/architecture.md         stack, layering, how a PR is checked, architecture rules (webhooks, evaluation, auth, cookies, start-up)
├── docs/repository-layout.md    this file
├── docs/data-model.md           tables, immutability, erasure, database roles
├── docs/security.md             auth model, role matrix, security and privacy rules
├── docs/privacy.md              privacy notes for operators: data inventory, retention, erasure runbook, backups, several orgs (kept true by src/server/docs)
├── docs/github-app.md           App permissions, events, check name, rules
├── docs/operations.md           key rotation, backups, poison jobs, rate budget, secrets and provisioning; the guides below
├── docs/operations/             the eight operator guides (E19-S09): install, reverse-proxy, upgrade, backup-restore, key-rotation, troubleshooting, uninstall, data-protection
├── docs/development/            test-database.md: running the tests against a PostgreSQL server and the test-database guard (E19-S10)
├── docs/decisions.md            why this project, decisions and their reasons, open questions
├── docs/tooling-gotchas.md      tool facts and traps, GitNexus, open tool verifications
├── docs/EPICS_STORIES.md        work queue index; the stories are in docs/epics/
├── scripts/eslint-layers.ts     the layering rules of the ESLint config, and their test
├── scripts/check-escape-hatches.ts  the escape-hatch justification gate (`yarn lint:hatches`); its modules, the ESLint
│                                block and the tests are in scripts/escape-hatches/
├── scripts/fetch-semgrep-rules.ts   downloads the five Semgrep rulesets into rules/ (`yarn semgrep:rules`); scripts/semgrep-rules/
│                                holds its logic and the tests of the Semgrep wiring
├── scripts/trivy-gate/          Trivy wiring: trivy.yaml, .trivyignore expiry, version pin, hook and CI job tests
├── scripts/mutation-gate/       the Stryker shards (shards.ts), the runner behind `yarn mutate` (mutate*.ts), the check that deletes an unreadable incremental file (check-incremental.ts, incremental-file.ts), the skip decision of the nightly run (decide-skip.ts, skip-cli.ts, skip-decision.ts, skip-github.ts, skip-http.ts), and the tests of the configs, the shards and the `mutation` job
├── scripts/e2e/  scripts/e2e-pin.test.ts   Playwright settings, container guards, spec rules; the version and digest pin test
├── scripts/leaks/               memlab wrapper logic (runner, outcome, exit guard, fixture server) and tests
├── scripts/qodana-gate/         tests of qodana.yaml, the token gate of the `qodana` job and the exclude-comment rule
├── scripts/ci-contract.test.ts  the CI contract test; scripts/ci-contract/ holds its parts (uses, workflow, required,
│                                package-scripts, dependabot, test-support)
├── src/server/docs/             tests that keep docs/privacy.md true (privacy-inventory, privacy-retention, privacy-sections; privacy-doc/ is test only)
├── scripts/docs/                doc-size.test.ts (README.md and CLAUDE.md stay under their byte ceilings), markdown.test.ts (relative links and |---| separators), development-test-database.test.ts and one operator-*.test.ts per guide of docs/operations/
├── scripts/init-secrets.sh      creates secrets/ and .env for the operator stack, once and never overwriting (E19-S04); scripts/compose/ runs it in scratch checkouts and tests the compose files
├── scripts/provision-database.sh  scripts/provision-database.sql: the idempotent provisioning of the database, its roles and the pgboss schema (E19-S03); scripts/provision/ has the tests with a stub psql
├── scripts/docker/              tests of the Dockerfile contract, the .dockerignore entries, the absence of any publication path and the read-only-root guard; the Dockerfile parser they share is test support
├── scripts/smoke/  tests/smoke/  the container smoke test (E19-S08, S12): scripts/smoke is the harness (compose, wait, http, one-off containers, reconfigure, dummy GitHub App, proxy, operator-commands, cleanup) and tests/smoke the scenarios, run by `yarn smoke` (a Vitest project outside yarn test)
├── scripts/check-code-caps.ts   structure-cap ratchet, entry (runs natively on Node 26)
├── scripts/code-caps/           its modules (types, naming, nesting, collector, measure, files, baseline,
│                                report, cli) and tests; a port of the Python tool; README.md describes the tool
├── scripts/ci/                  CI helpers, run natively: free-port, postgres (start/stop the CI database container),
│                                check-runners (the workflow guard), caddy.ts (`yarn ci:caddy`, validates docker/Caddyfile in a throw-away container, E19-S05), smoke.ts (`yarn ci:smoke stop`), install-trivy (the pinned Trivy release for the `trivy` job); logic and tests in lib/ (caddy-cli, caddy-run, caddy-deps, trivy-install)
├── scripts/dev/                 db.ts: local database on a random port (up, down, url, run); dev.ts: the Fastify and Vite dev servers (`yarn dev`); install-hooks.ts: the postinstall; logic and tests in lib/
├── scripts/web/                 the web wiring: eslint-config.ts (the inline-text and Web Storage rules), theme-init-build.ts (bundles /theme-init.js),
│                                test-support.ts, and the tests: vite-build.test.ts (builds the SPA and judges the output), vite-config, wiring,
│                                serving-wiring, theme-wiring, theme-init-build, zod-jitless and biome
├── .local/                      (git-ignored) the port that yarn db:up chose, and the passwords of the test role
├── types/                       ambient .d.ts for tools without types (eslint-plugin-no-unsanitized)
├── e2e/                         Playwright specs (smoke, canary), global-setup.ts, fixtures and visual baselines in __screenshots__/
├── tests/leaks/                 memlab scenarios, the control fixtures and the @memlab/api wrapper (run.ts)
├── tests/smoke/                 the scenarios of the container smoke test (boot, compose files, hardening, roles, configured mode, failure, backup, TLS)
├── LICENSE                      AGPL-3.0-only
├── rules/                       Semgrep rules cache, created by `yarn semgrep:rules` (git-ignored, never committed)
├── .github/workflows/ci.yml     jobs static, coverage, postgres, semgrep, trivy, mutation, e2e, caddy, container, leaks (self-hosted runners)
│                                and qodana (GitHub-hosted); .github/dependabot.yml
├── .code-caps-baseline.json
├── lefthook.yml  biome.json  eslint.config.mjs  fta.json  knip.json  vitest.config.ts
├── stryker.config.mjs  vitest.projects.ts  vitest.stryker.config.ts  vitest.stryker-scripts.config.ts
├── playwright.config.ts  qodana.yaml  trivy.yaml  .semgrepignore  .trivyignore
├── vite.config.ts                                                             the SPA build and the dev server (src/web is its root)
├── Dockerfile                                                                 the image, built from the checkout (E19-S01)
├── .nvmrc  mise.toml  .yarnrc.yml  package.json  yarn.lock  .gitattributes
├── tsconfig.json                solution-style root (files: [])
├── tsconfig.base.json  tsconfig.server.json  tsconfig.server.test.json  tsconfig.web.json
├── tsconfig.scripts.json  tsconfig.e2e.json  tsconfig.node.json
├── README.md  CLAUDE.md  CONTRIBUTING.md  CHANGELOG.md
```

The server compiles with `tsconfig.server.json` (composite, emits `dist/`, excludes tests, test helpers and the PGlite adapter). `tsconfig.server.test.json` type-checks the same sources plus every test, and ESLint and type-coverage run over both.
