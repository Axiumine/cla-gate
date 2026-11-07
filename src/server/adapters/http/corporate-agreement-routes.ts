// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { PAGE_SIZE, pageQuerySchema } from '../../../shared/cla.ts';
import {
  corporateAgreementListRoute,
  corporateAgreementParamsSchema,
  corporateAgreementRoute,
} from '../../../shared/corporate.ts';
import { listOwnAgreements, readOwnAgreement } from '../../services/corporate-agreements.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { presentOwnAgreement, presentOwnAgreements, readAgreementCursor } from './corporate-presenters.ts';
import { answerCorporateErrors } from './corporate-rule-errors.ts';
import { setNoStore } from './no-store.ts';
import { idText } from './query-values.ts';
import { parseInput } from './request-body.ts';

export interface CorporateAgreementRoutesOptions {
  readonly db: Kysely<Database>;
}

/** The path as text: plain digits for a positive integer, then the same rule as the descriptor's. Anything else is a `400`. */
const paramsText = z.object({ agreementId: idText.pipe(corporateAgreementParamsSchema.shape.agreementId) });

/**
 * `GET /api/corporate/agreements` and `GET /api/corporate/agreements/:agreementId` (E21-S02): the agreements the signed-in person
 * signed, in every organisation, newest first a page at a time, and one of them. Authority is being the signatory, so the person is
 * the one of the session and nobody can be named: the list path has no id and its query string holds `limit` and `cursor` only, and an
 * agreement that is not the caller's is a `404 not_found` that is the very answer for an id that names nothing. The answers are
 * never cached and hold no address; a revoked agreement is listed, marked `revoked`. They are served while an installation is
 * suspended.
 */
export const corporateAgreementRoutes: FastifyPluginCallbackZod<CorporateAgreementRoutesOptions> = (
  app,
  options,
  done,
) => {
  answerCorporateErrors(app);
  app.get(
    corporateAgreementListRoute.path,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: corporateAgreementListRoute.responses },
      exposeHeadRoute: false,
      config: { access: 'authenticated' },
    },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const query = parseInput(pageQuerySchema, request.query);
      const page = await listOwnAgreements(options.db, user.id, {
        limit: query.limit ?? PAGE_SIZE.default,
        from: query.cursor === undefined ? null : readAgreementCursor(query.cursor),
      });
      setNoStore(reply);
      return presentOwnAgreements(page);
    },
  );
  app.get(
    corporateAgreementRoute.path,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { params: paramsText, response: corporateAgreementRoute.responses },
      exposeHeadRoute: false,
      config: { access: 'authenticated' },
    },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const agreement = await readOwnAgreement(options.db, user.id, request.params.agreementId);
      setNoStore(reply);
      return { agreement: presentOwnAgreement(agreement) };
    },
  );
  done();
};
