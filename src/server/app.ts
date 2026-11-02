// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import helmet from '@fastify/helmet';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { Database } from './adapters/db/schema.ts';
import { requireAuditedRoutes } from './adapters/http/audit-routes.ts';
import { registerAuth } from './adapters/http/auth.ts';
import { registerErrorHandlers } from './adapters/http/errors.ts';
import { frameworkErrorHandlers } from './adapters/http/framework-errors.ts';
import { healthRoutes } from './adapters/http/health.ts';
import { HTTP_LIMITS } from './adapters/http/limits.ts';
import { createLogger } from './adapters/http/logger.ts';
import { registerRequestGuards } from './adapters/http/request-guards.ts';
import { generateRequestId, REQUEST_ID_HEADER } from './adapters/http/request-id.ts';
import { securityHeaders } from './adapters/http/security.ts';
import { fastifyTrustProxy } from './adapters/http/trust-proxy.ts';
import { authSettings } from './config/auth.ts';
import type { AppConfig } from './config/env.ts';
import { type Clock, systemClock } from './services/ports/clock.ts';

const DEFAULT_READINESS_TIMEOUT_MS = 2000;

export interface AppOptions {
  readonly config: AppConfig;
  /** The app owns it from here on: closing the app destroys the database. */
  readonly db: Kysely<Database>;
  /** Defaults to the pino logger from {@link createLogger}. */
  readonly logger?: FastifyBaseLogger;
  readonly readinessTimeoutMs?: number;
  /** Where the session lifetimes take "now" from (E10-S02). Defaults to the wall clock. */
  readonly clock?: Clock | undefined;
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

  await app.register(helmet, securityHeaders(config));
  app.addHook('onRequest', (request, reply, done) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
  const loginSettings = authSettings(config);
  registerRequestGuards(app, { publicBaseUrl: config.publicBaseUrl, sessionSecret: loginSettings?.sessionSecret });
  if (loginSettings !== undefined) {
    await registerAuth(app, { db, settings: loginSettings, clock: options.clock ?? systemClock });
  }
  await app.register(healthRoutes, {
    db,
    readinessTimeoutMs: options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
  });

  app.addHook('onClose', async () => {
    await db.destroy();
  });
  return app;
}
