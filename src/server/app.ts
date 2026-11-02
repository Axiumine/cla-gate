// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import helmet from '@fastify/helmet';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { Database } from './adapters/db/schema.ts';
import { requireAuditedRoutes } from './adapters/http/audit-routes.ts';
import { registerAuth } from './adapters/http/auth.ts';
import { noStoreForAuth } from './adapters/http/auth-no-store.ts';
import { registerErrorHandlers } from './adapters/http/errors.ts';
import { frameworkErrorHandlers } from './adapters/http/framework-errors.ts';
import { healthRoutes } from './adapters/http/health.ts';
import { HTTP_LIMITS } from './adapters/http/limits.ts';
import { createLogger } from './adapters/http/logger.ts';
import { operatorRoutes } from './adapters/http/operator-routes.ts';
import { registerRateLimit } from './adapters/http/rate-limit.ts';
import { registerRequestGuards } from './adapters/http/request-guards.ts';
import { generateRequestId, REQUEST_ID_HEADER } from './adapters/http/request-id.ts';
import { registerRoleCache } from './adapters/http/role-cache-slot.ts';
import { requireRouteAccess } from './adapters/http/route-access.ts';
import { guardRouteAccess } from './adapters/http/route-access-guard.ts';
import { securityHeaders } from './adapters/http/security.ts';
import { fastifyTrustProxy } from './adapters/http/trust-proxy.ts';
import { WEBHOOK_DEADLINE_MS } from './adapters/http/webhook-deadline.ts';
import { webhookRoutes } from './adapters/http/webhook-routes.ts';
import { authSettings } from './config/auth.ts';
import type { AppConfig } from './config/env.ts';
import { notWiredEnqueuer } from './services/jobs-not-wired.ts';
import { createOperatorPolicies, type OperatorPolicies } from './services/operator-policies.ts';
import { type Clock, systemClock } from './services/ports/clock.ts';
import type { JobEnqueuer } from './services/ports/jobs.ts';
import { RoleCache } from './services/role-cache.ts';
import { createTenantAuthorizer, type RoleGitHub, roleGitHubNotWired } from './services/tenant-authorizer.ts';

const DEFAULT_READINESS_TIMEOUT_MS = 2000;

export interface AppOptions {
  readonly config: AppConfig;
  /** The app owns it from here on: closing the app destroys the database. */
  readonly db: Kysely<Database>;
  /** Defaults to the pino logger from {@link createLogger}. */
  readonly logger?: FastifyBaseLogger;
  readonly readinessTimeoutMs?: number;
  /** Where the session lifetimes, the rate limit (E10-S02, E10-S08) and the webhook route (E06-S01) take "now" from. Defaults to the wall clock. */
  readonly clock?: Clock | undefined;
  /** How the login reaches GitHub (E10-S05). Defaults to the global `fetch`; tests intercept it with MSW. */
  readonly fetch?: typeof fetch | undefined;
  /** The ceiling of each call to GitHub during the login (E10-S05). Defaults to 10 seconds. */
  readonly githubTimeoutMs?: number | undefined;
  /** Where the webhook route sends the job of a delivery (E06-S06). Defaults to one that fails every send until the queue is wired (E07-S01). */
  readonly enqueuer?: JobEnqueuer;
  /** Milliseconds after which the webhook route answers `503` `webhook_timeout` (E06-S07). Defaults to 8 seconds, inside GitHub's 10. */
  readonly webhookDeadlineMs?: number;
  /** The cache of the roles GitHub reported (E11-S04), also read from `app.roleCache`. Defaults to an empty one on `clock`. */
  readonly roleCache?: RoleCache;
  /**
   * Where the guard of a tenant route reads the roles of the viewer (E11-S05): the GitHub client port, by numeric id. Defaults
   * to one that fails every call as an outage, so a server with no GitHub App never allows a tenant that needs a role from GitHub.
   */
  readonly github?: RoleGitHub | undefined;
  /**
   * Who operates the instance (E11-S08): `boot` passes the policy it built with the owner of the App. Defaults to the one
   * `OPERATOR_GITHUB_IDS` names, or to none when it is unset (the owner of the App is not known without the GitHub client).
   */
  readonly operators?: OperatorPolicies | undefined;
}

/**
 * What every route registered after it runs through, and the login routes (E10): the `no-store` header of `/api/auth`, the
 * rate limit, the Origin, session and CSRF guards, the guard of the route access declarations (E11-S01) and, when the login
 * is configured, the session lookup and `/api/auth`.
 * The webhook scope registered later inherits these hooks and opts out of them on its route (`csrf: 'exempt'`,
 * `rateLimit: false`).
 */
async function registerLoginChecks(
  app: FastifyInstance,
  options: AppOptions,
  clock: Clock,
  roleCache: RoleCache,
): Promise<void> {
  const { config, db } = options;
  // Before the rate limit, so that its 429 for a path no route answers carries the header too.
  app.addHook('onRequest', noStoreForAuth);
  await registerRateLimit(app, { trustProxy: config.trustProxy, clock });
  const loginSettings = authSettings(config);
  registerRequestGuards(app, { publicBaseUrl: config.publicBaseUrl, sessionSecret: loginSettings?.sessionSecret });
  // After the request guards, so the `Origin` and CSRF checks answer first; before the routes, which inherit the hook.
  // The guard of the tenant routes (E11-S05) reads the roles through the one role cache.
  const github = options.github ?? roleGitHubNotWired;
  const operators =
    options.operators ??
    createOperatorPolicies({ configured: config.github.operatorGithubIds, owner: undefined, logger: app.log });
  guardRouteAccess(app, {
    db,
    authorize: createTenantAuthorizer({ db, github, cache: roleCache, clock, log: app.log }),
    operators,
  });
  if (loginSettings !== undefined) {
    await registerAuth(app, {
      db,
      settings: loginSettings,
      clock,
      roleCache,
      fetch: options.fetch,
      githubTimeoutMs: options.githubTimeoutMs,
    });
  }
}

/**
 * The Fastify application, fully wired but not listening: tests call `app.inject()`, `boot()` calls `listen()`.
 * Routes are declared with zod schemas (fastify-type-provider-zod), so input is validated and output serialised
 * against the same contract that `src/shared` exports.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const logger = options.logger ?? createLogger(config);
  const framework = await frameworkErrorHandlers(config, logger);
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: fastifyTrustProxy(config.trustProxy),
    genReqId: generateRequestId,
    // Request ids are minted by genReqId; the header name is only used to echo it back below.
    requestIdHeader: false,
    ...HTTP_LIMITS,
    ...framework,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);
  requireAuditedRoutes(app);
  requireRouteAccess(app);

  await app.register(helmet, securityHeaders(config));
  app.addHook('onRequest', (request, reply, done) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
  const clock = options.clock ?? systemClock;
  const roleCache = options.roleCache ?? new RoleCache({ clock });
  registerRoleCache(app, roleCache);
  await registerLoginChecks(app, options, clock, roleCache);
  await app.register(healthRoutes, {
    db,
    readinessTimeoutMs: options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
  });

  await app.register(operatorRoutes, { db });

  await app.register(webhookRoutes, {
    secrets: { current: config.github.webhookSecret, previous: config.github.previousWebhookSecret },
    clock,
    appId: config.github.appId,
    db,
    enqueuer: options.enqueuer ?? notWiredEnqueuer,
    deadlineMs: options.webhookDeadlineMs ?? WEBHOOK_DEADLINE_MS,
  });

  app.addHook('onClose', async () => {
    await db.destroy();
  });
  return app;
}
