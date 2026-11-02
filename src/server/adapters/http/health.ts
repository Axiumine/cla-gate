// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { FastifyContextConfig } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { type Kysely, sql } from 'kysely';
import type { z } from 'zod';
import { healthResponseSchema, readyResponseSchema, unavailableResponseSchema } from '../../../shared/health.ts';
import type { JobQueue } from '../../services/ports/jobs.ts';
import type { Database } from '../db/schema.ts';

export interface HealthRoutesOptions {
  readonly db: Kysely<Database>;
  /** How long `/readyz` waits for the database before it answers 503. */
  readonly readinessTimeoutMs: number;
  /** The job queue (E07-S01): `/readyz` is 503 while it is not ready. Left out for a server built without one. */
  readonly queue?: Pick<JobQueue, 'isReady'> | undefined;
}

/** True when `check` answers true within the timeout. Says nothing about why it did not. */
async function answersInTime(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const expired = new Promise<never>((_resolve, reject) => {
    timeout.addEventListener(
      'abort',
      () => {
        // Stryker disable next-line StringLiteral: the reason is thrown away by the catch below, only the rejection matters
        reject(new Error('the check did not answer in time'));
      },
      // Stryker disable next-line ObjectLiteral,BooleanLiteral: an AbortSignal aborts once, so the listener runs once either way
      { once: true },
    );
  });
  try {
    return await Promise.race([check(), expired]);
  } catch {
    return false;
  }
}

/** What both probes declare: public, and they never read the session, so the session hook (E10-S02) leaves them alone, whatever cookie a browser sends. */
const PROBE = { access: 'public', session: 'none' } satisfies FastifyContextConfig;

/** True when the database answers a trivial query within the timeout. */
function databaseAnswers(db: Kysely<Database>, timeoutMs: number): Promise<boolean> {
  return answersInTime(async () => {
    await sql`select 1`.execute(db);
    return true;
  }, timeoutMs);
}

/** True when there is no queue, or the queue says it is ready within the timeout. */
function queueReady(queue: Pick<JobQueue, 'isReady'> | undefined, timeoutMs: number): Promise<boolean> {
  return queue === undefined ? Promise.resolve(true) : answersInTime(() => queue.isReady(), timeoutMs);
}

/**
 * `GET /healthz` is liveness: the process serves requests, no dependency is touched. `GET /readyz` is readiness: the
 * database answered and the job queue, when there is one, is ready (E07-S01). Both bodies are fixed, so neither can leak
 * anything.
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
      const timeoutMs = options.readinessTimeoutMs;
      const [database, queue] = await Promise.all([
        databaseAnswers(options.db, timeoutMs),
        queueReady(options.queue, timeoutMs),
      ]);
      if (database && queue) {
        return { status: 'ready' };
      }
      if (!database) {
        request.log.warn('readiness check failed: the database did not answer');
      }
      if (!queue) {
        request.log.warn('readiness check failed: the job queue is not ready');
      }
      return reply.code(503).send({ status: 'unavailable' });
    },
  );
  done();
};
