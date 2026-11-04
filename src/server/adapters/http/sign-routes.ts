// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { SIGN_REFUSAL_STATUS, signRequestSchema, signRoute } from '../../../shared/sign.ts';
import type { SignRefusal } from '../../domain/sign-request.ts';
import { networkMetadataOf } from '../../services/network-metadata.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { recordSignature, type SignOutcome } from '../../services/sign-record.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';
import { SIGN_BODY_LIMIT } from './limits.ts';
import { setNoStore } from './no-store.ts';
import { RATE_LIMITS, userRateLimit } from './rate-limit.ts';
import { parseInput } from './request-body.ts';
import { answerSignRuleErrors } from './sign-rule-errors.ts';

export interface SignRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where the evaluations a new signature asks for are sent (E13-S07), in the transaction that records it. */
  readonly enqueuer: JobEnqueuer;
  /** `RECORD_NETWORK_METADATA` (E13-S05): when false, the request's address and `User-Agent` are not read at all. */
  readonly recordNetworkMetadata: boolean;
}

/**
 * The error a refused request is answered with: the status and code of its rule, and, for a stale version, the version in force
 * (its id, numbers and hash) so that the page can load it. Nothing the person typed is in it.
 */
function refusalError(refusal: SignRefusal): AppError {
  const status = SIGN_REFUSAL_STATUS[refusal.rule];
  return refusal.rule === 'stale_version'
    ? new AppError(status, refusal.rule, { current: { ...refusal.current } })
    : new AppError(status, refusal.rule);
}

/**
 * The signature of an outcome, or the error that the outcome is answered with. An unknown repository and one whose organisation is
 * not served are the same `404` (the sign page context answers them alike); a repository with no CLA in force is a `409`.
 * @throws AppError for everything but a recorded signature.
 */
function signatureOf(outcome: SignOutcome) {
  switch (outcome.kind) {
    case 'signed':
      return { signature: outcome.signature, created: outcome.created };
    case 'not_found':
      throw new AppError(404, 'not_found');
    case 'no_active_cla':
      throw new AppError(409, 'no_active_cla');
    case 'refused':
      throw refusalError(outcome.refusal);
  }
}

/** The signature as the wire carries it: the instant as ISO 8601 in UTC, and no name, address or login. */
function present(answer: ReturnType<typeof signatureOf>) {
  const { signature } = answer;
  return {
    signature: {
      id: signature.id,
      versionId: signature.versionId,
      major: signature.major,
      minor: signature.minor,
      signedAt: signature.signedAt.toISOString(),
    },
    created: answer.created,
  };
}

/**
 * `POST /api/sign` (E13-S04): records the signature of the signed-in person for the version of the CLA that the repository enforces,
 * with the name they typed and one of their verified addresses, and answers `201` (a new signature) or `200` (one existed: nothing
 * was written). Any signed-in person may sign; the tenant is not chosen by the caller but found from the repository, and every
 * write carries its installation id. Behind the session, `Origin` and CSRF checks of E10. The budget is 10 requests a minute for each
 * person, keyed on the numeric GitHub id and spent after the guards have let the call in (`userRateLimit`). The body is read by
 * the handler and not by a route schema: Fastify validates a body before the guards run, and a request from another site or with no
 * session must not learn how its input was read. A rule the name or the address breaks is answered by the error handler of this scope.
 * The address and the `User-Agent` of the request go to `signer_pii` only when the operator switched `RECORD_NETWORK_METADATA` on
 * (E13-S05); otherwise the handler does not read them. A new signature also sends the `evaluate-pr` jobs that turn the person's
 * red checks green (E13-S07), in the same transaction, so a queue that fails answers `500` and records nothing.
 */
export const signRoutes: FastifyPluginCallbackZod<SignRoutesOptions> = (app, options, done) => {
  answerSignRuleErrors(app);
  app.post(
    signRoute.path,
    {
      bodyLimit: SIGN_BODY_LIMIT,
      // The body has no schema here (see above). Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: signRoute.responses },
      config: {
        access: 'authenticated',
        audit: 'signature.created',
        rateLimit: userRateLimit(RATE_LIMITS.sign),
      },
    },
    async (request, reply) => {
      const body = parseInput(signRequestSchema, request.body);
      const { user, sessionId } = requireAuth(request);
      const outcome = await recordSignature(options.db, options.enqueuer, {
        request: body,
        viewer: { userId: user.id, githubId: user.githubId, login: user.login, sessionRowId: sessionId },
        network: networkMetadataOf(request, options.recordNetworkMetadata),
      });
      const answer = present(signatureOf(outcome));
      setNoStore(reply);
      reply.statusCode = answer.created ? 201 : 200;
      return answer;
    },
  );
  done();
};
