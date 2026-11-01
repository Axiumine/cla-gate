// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import helmet from '@fastify/helmet';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { Database } from './adapters/db/schema.ts';
import { registerErrorHandlers } from './adapters/http/errors.ts';
import { frameworkErrorHandlers } from './adapters/http/framework-errors.ts';
import { healthRoutes } from './adapters/http/health.ts';
import { HTTP_LIMITS } from './adapters/http/limits.ts';
import { createLogger } from './adapters/http/logger.ts';
import { generateRequestId, REQUEST_ID_HEADER } from './adapters/http/request-id.ts';
import { securityHeaders } from './adapters/http/security.ts';
import type { AppConfig } from './config/env.ts';
import type { TrustProxy } from './config/trust-proxy.ts';

const DEFAULT_READINESS_TIMEOUT_MS = 2000;

/**
 * Fastify accepts a hop count at runtime but its types do not list one, so a count becomes the equivalent function.
 * @returns the setting in a form Fastify's types accept: a boolean, a list of addresses or a trust function.
 */
function fastifyTrustProxy(setting: TrustProxy): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof setting === 'number') {
    return (_address, hop) => hop < setting;
  }
  return typeof setting === 'boolean' ? setting : [...setting];
}

export interface AppOptions {
  readonly config: AppConfig;
  /** The app owns it from here on: closing the app destroys the database. */
  readonly db: Kysely<Database>;
  /** Defaults to the pino logger from {@link createLogger}. */
  readonly logger?: FastifyBaseLogger;
  readonly readinessTimeoutMs?: number;
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

  await app.register(helmet, securityHeaders(config));
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
  await app.register(healthRoutes, {
    db,
    readinessTimeoutMs: options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
  });

  app.addHook('onClose', async () => {
    await db.destroy();
  });
  return app;
}
