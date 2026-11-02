// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { FastifyContextConfig } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { type Kysely, sql } from 'kysely';
import type { z } from 'zod';
import { healthResponseSchema, readyResponseSchema, unavailableResponseSchema } from '../../../shared/health.ts';
import type { Database } from '../db/schema.ts';

export interface HealthRoutesOptions {
  readonly db: Kysely<Database>;
  /** How long `/readyz` waits for the database before it answers 503. */
  readonly readinessTimeoutMs: number;
}

/** True when the database answers a trivial query within the timeout. Says nothing about why it did not. */
async function databaseAnswers(db: Kysely<Database>, timeoutMs: number): Promise<boolean> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const expired = new Promise<never>((_resolve, reject) => {
    timeout.addEventListener(
      'abort',
      () => {
        // Stryker disable next-line StringLiteral: the reason is thrown away by the catch below, only the rejection matters
        reject(new Error('the database did not answer in time'));
      },
      // Stryker disable next-line ObjectLiteral,BooleanLiteral: an AbortSignal aborts once, so the listener runs once either way
      { once: true },
    );
  });
  try {
    await Promise.race([sql`select 1`.execute(db), expired]);
    return true;
  } catch {
    return false;
  }
}

/** What both probes declare: public, and they never read the session, so the session hook (E10-S02) leaves them alone, whatever cookie a browser sends. */
const PROBE = { access: 'public', session: 'none' } satisfies FastifyContextConfig;

/**
 * `GET /healthz` is liveness: the process serves requests, no dependency is touched. `GET /readyz` is readiness: the
 * database answered. Both bodies are fixed, so neither can leak anything.
 */
export const healthRoutes: FastifyPluginCallbackZod<HealthRoutesOptions> = (app, options, done) => {
  app.get(
    '/healthz',
    // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
    { schema: { response: { 200: healthResponseSchema } }, config: PROBE },
    (): z.infer<typeof healthResponseSchema> => ({
      status: 'ok',
    }),
  );

  app.get(
    '/readyz',
    // Stryker disable next-line ObjectLiteral: the response schemas restate what the handler returns, so dropping them changes no response
    { schema: { response: { 200: readyResponseSchema, 503: unavailableResponseSchema } }, config: PROBE },
    async (request, reply): Promise<z.infer<typeof readyResponseSchema | typeof unavailableResponseSchema>> => {
      if (await databaseAnswers(options.db, options.readinessTimeoutMs)) {
        return { status: 'ready' };
      }
      request.log.warn('readiness check failed: the database did not answer');
      return reply.code(503).send({ status: 'unavailable' });
    },
  );
  done();
};
