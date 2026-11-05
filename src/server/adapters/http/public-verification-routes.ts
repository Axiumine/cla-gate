// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { PUBLIC_SIGNER_PATH, publicSignerResponseSchema } from '../../../shared/public-verification.ts';
import type { Clock } from '../../services/ports/clock.ts';
import { LoginCache } from '../../services/public-login-cache.ts';
import { LookupBudget } from '../../services/public-lookup-budget.ts';
import type { PublicGitHub } from '../../services/public-verification.ts';
import type { Database } from '../db/schema.ts';
import { publicRouteOptions, signedByPath } from './public-answers.ts';
import { publicBadgeRoutes } from './public-badge-routes.ts';
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
 * `GET /api/public/repos/:githubRepoId/signers/:login` (E22-S02): public, no session and no cookie, and the answer to one question,
 * "does this GitHub login have a valid signature for this repository". `200 { signed }` is all it says; `404 not_found` is the
 * same answer for a repository that is unknown, not enforcing, not opted in, or whose installation is not served, so the call
 * is no way to find out which repositories exist. A path parameter that is not what GitHub allows is `400 invalid_input`, answered
 * before any read. The two budgets of {@link publicRateLimit} run first (`429 rate_limited` with `Retry-After`); a login GitHub
 * cannot resolve is `503 upstream_unavailable` with `Retry-After` and never a guess. The access log writes the route template and
 * never the login (the serializer of logger.ts), and the answer to a good call may be cached for five minutes. The two badges of
 * E22-S03 (public-badge-routes.ts) are registered here too: they share the hooks, the one hook of the budgets and the memory of
 * the logins with this call.
 */
export const publicVerificationRoutes: FastifyPluginCallbackZod<PublicVerificationRoutesOptions> = (
  app,
  options,
  done,
) => {
  const deps = {
    db: options.db,
    github: options.github,
    logins: new LoginCache(options.clock),
    budget: new LookupBudget(options.clock),
  };
  // Made once: the JSON call and the badges draw on the same two buckets (E22-S02, E22-S03).
  const limit = publicRateLimit(app);
  app.addHook('onSend', publicHeaders);
  app.get(
    PUBLIC_SIGNER_PATH,
    {
      ...publicRouteOptions(limit),
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: publicSignerResponseSchema } },
    },
    async (request, reply) => {
      const signed = await signedByPath(deps, request);
      setPublicCache(reply);
      return { signed };
    },
  );
  publicBadgeRoutes(app, { deps, limit });
  done();
};
