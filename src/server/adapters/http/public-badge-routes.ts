// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { PUBLIC_BADGE_PATH, PUBLIC_SIGNER_BADGE_PATH } from '../../../shared/public-verification.ts';
import type { PublicVerificationDeps } from '../../services/public-verification.ts';
import { publicRouteOptions, requirePublicRepository, signedByPath } from './public-answers.ts';
import { sendBadge } from './public-headers.ts';
import type { PublicRateLimit } from './public-rate-limit.ts';

/** The instance the badge routes are set on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

export interface PublicBadgeRoutesOptions {
  /** What the signer badge asks the one question with, shared with the JSON call so both draw on the same memory of logins. */
  readonly deps: PublicVerificationDeps;
  /** The one hook of the budgets (E22-S02): the badges draw on the buckets of the JSON call and not on a pair of their own. */
  readonly limit: PublicRateLimit;
}

/**
 * The two badges of the public signature check (E22-S03), registered next to `GET /api/public/repos/:githubRepoId/signers/:login`
 * (public-verification-routes.ts) and under the same rules: no session and no cookie, the two budgets of E22-S02 (shared, not one
 * per route), the hooks that put `Access-Control-Allow-Origin: *` on every answer and `no-store` on every refusal, and an access log
 * that records the route template and never the login.
 *
 * - `GET /api/public/repos/:githubRepoId/badge.svg` is "CLA | required" for a repository that is enforcing and opted in, and the very
 *   `404 not_found` of the JSON call for any other, so it is no way to find out which repositories exist. It asks nothing of GitHub.
 * - `GET /api/public/repos/:githubRepoId/signers/:login/badge.svg` is "CLA | signed" or "CLA | not signed" from `verifySigner`, the
 *   one decision the JSON call is made from; a login that is not a login is `400 invalid_input`, a login GitHub cannot resolve is
 *   `503 upstream_unavailable` with `Retry-After`, and a login nobody has is "not signed" with status 200, like one that never signed.
 *
 * The bodies are three fixed templates (`badgeSvg`): nothing the request carries is in an image.
 */
export function publicBadgeRoutes(app: Routes, options: PublicBadgeRoutesOptions): void {
  const { deps, limit } = options;
  const route = publicRouteOptions(limit);
  app.get(PUBLIC_BADGE_PATH, route, async (request, reply) => {
    await requirePublicRepository(deps.db, request);
    return sendBadge(reply, 'required');
  });
  app.get(PUBLIC_SIGNER_BADGE_PATH, route, async (request, reply) => {
    const signed = await signedByPath(deps, request);
    return sendBadge(reply, signed ? 'signed' : 'not_signed');
  });
}
