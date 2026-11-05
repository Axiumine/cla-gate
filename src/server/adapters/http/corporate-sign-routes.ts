// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import {
  corporateAgreementCreateRoute,
  corporateAgreementRequestSchema,
  corporateDocumentParamsSchema,
  corporateDocumentRoute,
} from '../../../shared/corporate.ts';
import { recordCorporateAgreement } from '../../services/corporate-sign.ts';
import { resolveCorporateTarget } from '../../services/corporate-target.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { presentCorporateDocument, presentSignedAgreement } from './corporate-presenters.ts';
import { answerCorporateErrors } from './corporate-rule-errors.ts';
import { SIGN_BODY_LIMIT } from './limits.ts';
import { setNoStore } from './no-store.ts';
import { idText } from './query-values.ts';
import { RATE_LIMITS, userRateLimit } from './rate-limit.ts';
import { parseInput } from './request-body.ts';

export interface CorporateSignRoutesOptions {
  readonly db: Kysely<Database>;
}

/** The path as text: plain digits for a positive integer, then the same rule as the descriptor's. Anything else is a `400`. */
const paramsText = z.object({ githubRepoId: idText.pipe(corporateDocumentParamsSchema.shape.githubRepoId) });

/**
 * `GET /api/corporate/repositories/:githubRepoId/document` (E21-S02): the corporate CLA in force for a repository, with its stored text
 * and the hash a signing request sends back. Any signed-in person may ask: the tenant is found from the repository and the route is
 * open to people who belong to no organisation. It writes nothing. The answer is never cached. An unknown repository and one whose
 * organisation is not served are the same `404 not_found`; a repository that is not enabled, has no corporate CLA, or whose CLA has no
 * published version is a `404 corporate_cla_not_configured`. A suspended installation is read as usual.
 *
 * `POST /api/corporate/agreements` (E21-S02): the signatory signs for the company and becomes the CLA manager of the agreement; `201`
 * with the agreement. Behind the session, `Origin` and CSRF checks of E10, with a budget of its own for each person (keyed on the
 * numeric GitHub id and spent after the guards, `userRateLimit`). The body is read by the handler and not by a route schema, so a
 * request with no session or from another site learns nothing of how its input is read. The rules of the request are answered by the
 * error handler of this plugin; a write for a suspended installation is `409 installation_suspended`. Audited as
 * `corporate_agreement.signed` in the transaction of the signing.
 */
export const corporateSignRoutes: FastifyPluginCallbackZod<CorporateSignRoutesOptions> = (app, options, done) => {
  answerCorporateErrors(app);
  app.get(
    corporateDocumentRoute.path,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { params: paramsText, response: corporateDocumentRoute.responses },
      exposeHeadRoute: false,
      config: { access: 'authenticated' },
    },
    async (request, reply) => {
      setNoStore(reply);
      return presentCorporateDocument(await resolveCorporateTarget(options.db, request.params.githubRepoId, 'read'));
    },
  );
  app.post(
    corporateAgreementCreateRoute.path,
    {
      bodyLimit: SIGN_BODY_LIMIT,
      // The body has no schema here (see above). Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: corporateAgreementCreateRoute.responses },
      config: {
        access: 'authenticated',
        audit: 'corporate_agreement.signed',
        rateLimit: userRateLimit(RATE_LIMITS.corporateSign),
      },
    },
    async (request, reply) => {
      const body = parseInput(corporateAgreementRequestSchema, request.body);
      const { user, sessionId } = requireAuth(request);
      const agreement = await recordCorporateAgreement(options.db, {
        request: body,
        viewer: { userId: user.id, githubId: user.githubId, login: user.login, sessionRowId: sessionId },
      });
      setNoStore(reply);
      reply.statusCode = 201;
      return presentSignedAgreement(agreement);
    },
  );
  done();
};
