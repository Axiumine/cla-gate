// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { prNumberSchema, signContextParamsSchema, signContextRoute } from '../../../shared/sign-context.ts';
import { loadSignContext } from '../../services/sign-context.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';
import { setNoStore } from './no-store.ts';
import { idText } from './query-values.ts';

export interface SignContextRoutesOptions {
  readonly db: Kysely<Database>;
}

/** The path as text: plain digits for a positive integer, then the same rule as the descriptor's. Anything else is a `400`. */
const paramsText = z.object({ githubRepoId: idText.pipe(signContextParamsSchema.shape.githubRepoId) });

/** The query string as text: `pr` in plain digits within the range of a pull request number, and no other key. */
const queryText = z.strictObject({ pr: idText.pipe(prNumberSchema).optional() });

/**
 * `GET /api/sign/:githubRepoId` (E13-S02): what the sign page needs, in one read. Any signed-in person may ask: the tenant is
 * not chosen by the caller but found from the repository, and the route is open to people who belong to no organisation (a
 * contributor). It writes nothing: no row, no job, no audit entry. The answer is never cached and never a redirect. An unknown
 * repository and one of an installation that is suspended, uninstalled or not admitted are the same `404`; a repository with no
 * CLA in force is a `409` `no_active_cla`. The path and the schemas are the descriptor's (`signContextRoute`), the very value the
 * sign page calls it by.
 */
export const signContextRoutes: FastifyPluginCallbackZod<SignContextRoutesOptions> = (app, options, done) => {
  app.get(
    signContextRoute.path,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { params: paramsText, querystring: queryText, response: signContextRoute.responses },
      exposeHeadRoute: false,
      config: { access: 'authenticated' },
    },
    async (request, reply) => {
      setNoStore(reply);
      const { user, sessionId } = requireAuth(request);
      const outcome = await loadSignContext(options.db, {
        githubRepoId: request.params.githubRepoId,
        prNumber: request.query.pr ?? null,
        viewer: { userId: user.id, githubId: user.githubId, login: user.login, sessionRowId: sessionId },
      });
      if (outcome.kind === 'not_found') {
        throw new AppError(404, 'not_found');
      }
      if (outcome.kind === 'no_active_cla') {
        throw new AppError(409, 'no_active_cla');
      }
      return outcome.context;
    },
  );
  done();
};
