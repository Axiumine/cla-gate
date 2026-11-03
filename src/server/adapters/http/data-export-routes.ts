// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { DATA_EXPORT_PATH, dataExportSchema } from '../../../shared/data-export.ts';
import { exportOwnData } from '../../services/export/own-data.ts';
import type { Clock } from '../../services/ports/clock.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { setNoStore } from './no-store.ts';
import { HOUR_MS, RATE_LIMITS, userRateLimit } from './rate-limit.ts';

export interface DataExportRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the instant of the document comes from. */
  readonly clock: Clock;
}

/**
 * The query string of `GET /api/me/export`: it has none. The subject is the person of the session and nobody can be named, so
 * any parameter (`githubId`, `userId`, `login`, anything) is a `400` and not a request that is quietly answered for the caller.
 */
const noQuery = z.strictObject({});

/**
 * Marks the answer as a download named after the person's numeric GitHub id, which is the only thing in the name. A function of
 * its own, for the reason of {@link setNoStore}: the result of `header` is a thenable and is dropped on purpose.
 */
function setAttachment(reply: FastifyReply, githubId: number): void {
  void reply.header('content-disposition', `attachment; filename="cla-data-${githubId}.json"`);
}

/**
 * `GET /api/me/export` (E16-S06): everything the instance holds about the signed-in person, across all orgs, as one JSON
 * document (`dataExportSchema`). Any signed-in person may ask, five times an hour; the data is selected by the numeric GitHub id
 * of the session and by nothing in the request. The audit row `data_export.created` is written in the transaction that reads
 * the data. The answer is a download and is never cached.
 */
export const dataExportRoutes: FastifyPluginCallbackZod<DataExportRoutesOptions> = (app, options, done) => {
  app.get(
    DATA_EXPORT_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { querystring: noQuery, response: { 200: dataExportSchema } },
      // A HEAD twin would have a budget of its own and double the person's.
      exposeHeadRoute: false,
      config: {
        access: 'authenticated',
        rateLimit: userRateLimit(RATE_LIMITS.dataExport, HOUR_MS),
      },
    },
    async (request, reply) => {
      const { githubId } = requireAuth(request).user;
      const data = await exportOwnData(options.db, githubId, options.clock.now());
      setNoStore(reply);
      setAttachment(reply, githubId);
      return data;
    },
  );
  done();
};
