// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import {
  PUBLIC_SIGNER_PATH,
  publicSignerParamsSchema,
  publicSignerResponseSchema,
} from '../../../shared/public-verification.ts';
import type { Clock } from '../../services/ports/clock.ts';
import { LoginCache } from '../../services/public-login-cache.ts';
import { type PublicGitHub, verifySigner } from '../../services/public-verification.ts';
import type { Database } from '../db/schema.ts';
import { AppError } from './errors.ts';
import { publicHeaders, setPublicCache } from './public-headers.ts';
import { publicRateLimit } from './public-rate-limit.ts';

export interface PublicVerificationRoutesOptions {
  readonly db: Kysely<Database>;
  /** Where a login is turned into GitHub's numeric id (E22-S02): the GitHub client port, with the token of the repository's installation. */
  readonly github: PublicGitHub;
  /** Where the memory of the logins takes "now" from. */
  readonly clock: Clock;
}

/**
 * The path parameters of the call, read with the shared schema.
 * @throws AppError 400 `invalid_input` when the repository id is not a positive safe integer in plain digits or the login does not have the shape of a GitHub login.
 */
function publicParamsOf(request: FastifyRequest) {
  const parsed = publicSignerParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    throw new AppError(400, 'invalid_input');
  }
  return parsed.data;
}

/**
 * `GET /api/public/repos/:githubRepoId/signers/:login` (E22-S02): public, no session and no cookie, and the answer to one question,
 * "does this GitHub login have a valid signature for this repository". `200 { signed }` is all it says; `404 not_found` is the
 * same answer for a repository that is unknown, not enforcing, not opted in, or whose installation is not served, so the call
 * is no way to find out which repositories exist. A path parameter that is not what GitHub allows is `400 invalid_input`, answered
 * before any read. The two budgets of {@link publicRateLimit} run first (`429 rate_limited` with `Retry-After`); a login GitHub
 * cannot resolve is `503 upstream_unavailable` with `Retry-After` and never a guess. The access log writes the route template and
 * never the login (the serializer of logger.ts), and the answer to a good call may be cached for five minutes.
 */
export const publicVerificationRoutes: FastifyPluginCallbackZod<PublicVerificationRoutesOptions> = (
  app,
  options,
  done,
) => {
  const deps = { db: options.db, github: options.github, logins: new LoginCache(options.clock) };
  app.addHook('onSend', publicHeaders);
  app.get(
    PUBLIC_SIGNER_PATH,
    {
      onRequest: publicRateLimit(app),
      // The call is `GET` only: no `HEAD` twin that would answer, and be counted, on its own.
      exposeHeadRoute: false,
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: publicSignerResponseSchema } },
      config: { access: 'public', session: 'none' },
    },
    async (request, reply) => {
      const verdict = await verifySigner(deps, publicParamsOf(request));
      if (verdict.kind === 'not_found') {
        throw new AppError(404, 'not_found');
      }
      setPublicCache(reply);
      return { signed: verdict.signed };
    },
  );
  done();
};
