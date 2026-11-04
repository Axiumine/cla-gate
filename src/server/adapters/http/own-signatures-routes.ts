// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { PAGE_SIZE, pageQuerySchema } from '../../../shared/cla.ts';
import { OWN_SIGNATURES_PATH, ownSignaturesRoute } from '../../../shared/own-signatures.ts';
import { listOwnSignatures } from '../../services/own-signatures.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { setNoStore } from './no-store.ts';
import { presentOwnSignatures, readOwnSignatureCursor } from './own-signature-presenters.ts';
import { parseInput } from './request-body.ts';

export interface OwnSignaturesRoutesOptions {
  readonly db: Kysely<Database>;
}

/**
 * `GET /api/me/signatures` (E13-S06): the CLAs the signed-in person signed, across all orgs of the instance, newest first, a page
 * at a time. The person is the one of the session and nobody can be named: the path has no id and the query string holds `limit`
 * and `cursor` only, so `?userId=2` is a `400`, not a request quietly answered for the caller. The query is read in the handler,
 * after the session, so a request with no session learns nothing of how its input is read. The answer is never cached. It
 * lists signatures of a suspended installation as well (they are kept), and holds no name, address or reason of a revocation.
 */
export const ownSignaturesRoutes: FastifyPluginCallbackZod<OwnSignaturesRoutesOptions> = (app, options, done) => {
  app.get(
    OWN_SIGNATURES_PATH,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: ownSignaturesRoute.responses },
      exposeHeadRoute: false,
      config: { access: 'authenticated' },
    },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const query = parseInput(pageQuerySchema, request.query);
      const page = await listOwnSignatures(options.db, user.id, {
        limit: query.limit ?? PAGE_SIZE.default,
        from: query.cursor === undefined ? null : readOwnSignatureCursor(query.cursor),
      });
      setNoStore(reply);
      return presentOwnSignatures(page);
    },
  );
  done();
};
