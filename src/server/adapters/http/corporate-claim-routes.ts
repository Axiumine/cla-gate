// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { corporateDocumentParamsSchema } from '../../../shared/corporate.ts';
import {
  corporateAvailabilityRoute,
  corporateClaimRequestSchema,
  corporateClaimRoute,
} from '../../../shared/corporate-claims.ts';
import type { CorporateGitHub } from '../../services/corporate-approval-lookup.ts';
import { claimCoverage, corporateAvailable } from '../../services/corporate-claim.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { answerCorporateErrors } from './corporate-rule-errors.ts';
import { SIGN_BODY_LIMIT } from './limits.ts';
import { setNoStore } from './no-store.ts';
import { idText } from './query-values.ts';
import { HOUR_MS, RATE_LIMITS, userRateLimit } from './rate-limit.ts';
import { parseInput } from './request-body.ts';

export interface CorporateClaimRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the account and the membership of an employee are checked (E21-S04): the GitHub client port, by numeric id. */
  readonly github: CorporateGitHub;
  /** Where the evaluations of the employee's pull requests are sent, in the transaction of the claim. */
  readonly enqueuer: JobEnqueuer;
}

/** The path as text: plain digits for a positive integer, then the same rule as the descriptor's. Anything else is a `400`. */
const paramsText = z.object({ githubRepoId: idText.pipe(corporateDocumentParamsSchema.shape.githubRepoId) });

/**
 * `GET /api/corporate/repositories/:githubRepoId/availability` (E21-S04): whether the repository offers the claim of an employee, which the
 * signing page reads to decide whether to show "Contributing for an employer?". Any signed-in person may ask. It writes nothing and names
 * no company; a repository that does not exist and one whose organisation is not served are `false`, as one with no agreement is. The answer
 * is never cached.
 *
 * `POST /api/corporate/repositories/:githubRepoId/claims` (E21-S04): the signed-in person asks to be covered by an employer's corporate CLA.
 * `201 { "status": "covered" }` when a rule matched and an approval was derived, `200 { "status": "already_covered" }` when they had one,
 * `409 no_matching_approval` when nothing covers them, `503 upstream_unavailable` when GitHub could not say (nothing is written). Behind the
 * session, `Origin` and CSRF checks of E10, with a budget of 10 an hour for each person (keyed on the numeric GitHub id and spent after the
 * guards, `userRateLimit`). The path and the body are read by the handler and not by route schemas, so a request with no session or from
 * another site learns nothing of how its input is read. Audited as `corporate_approval.derived` in the transaction of the claim that derived
 * an approval.
 */
export const corporateClaimRoutes: FastifyPluginCallbackZod<CorporateClaimRoutesOptions> = (app, options, done) => {
  answerCorporateErrors(app);
  app.get(
    corporateAvailabilityRoute.path,
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { params: paramsText, response: corporateAvailabilityRoute.responses },
      exposeHeadRoute: false,
      config: { access: 'authenticated' },
    },
    async (request, reply) => {
      setNoStore(reply);
      return { corporateAvailable: await corporateAvailable(options.db, request.params.githubRepoId) };
    },
  );
  app.post(
    corporateClaimRoute.path,
    {
      bodyLimit: SIGN_BODY_LIMIT,
      // The path and the body have no schema here (see above). Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: corporateClaimRoute.responses },
      config: {
        access: 'authenticated',
        audit: 'corporate_approval.derived',
        rateLimit: userRateLimit(RATE_LIMITS.corporateClaim, HOUR_MS),
      },
    },
    async (request, reply) => {
      const { githubRepoId } = parseInput(paramsText, request.params);
      parseInput(corporateClaimRequestSchema, request.body);
      const { user, sessionId } = requireAuth(request);
      const status = await claimCoverage(
        options,
        { userId: user.id, githubId: user.githubId, login: user.login, sessionRowId: sessionId },
        githubRepoId,
      );
      setNoStore(reply);
      reply.statusCode = status === 'covered' ? 201 : 200;
      return { status };
    },
  );
  done();
};
