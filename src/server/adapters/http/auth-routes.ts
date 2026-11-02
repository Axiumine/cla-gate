// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { sessionResponseSchema } from '../../../shared/auth.ts';
import type { Secret } from '../../config/secret.ts';
import { requireAuth } from './auth-request.ts';
import { csrfToken } from './csrf-token.ts';
import { RATE_LIMITS, routeRateLimit } from './rate-limit.ts';

interface AuthRoutesOptions {
  /** The key the CSRF token of a session derives from (E10-S03). */
  readonly sessionSecret: Secret;
}

/**
 * `GET /api/auth/session`: who the SPA is logged in as, until when, and the token it sends back in `x-csrf-token` on
 * every state-changing request. Without a live session it answers 401 and, when the request did send a session cookie,
 * clears it (a dead cookie would otherwise be sent, and refused, for ever): both are done by the guard of the
 * `authenticated` declaration (E11-S01) before this handler runs.
 */
export const authRoutes: FastifyPluginCallbackZod<AuthRoutesOptions> = (app, options, done) => {
  app.get(
    '/api/auth/session',
    {
      // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
      schema: { response: { 200: sessionResponseSchema } },
      config: { access: 'authenticated', rateLimit: routeRateLimit(RATE_LIMITS.session) },
      exposeHeadRoute: false,
    },
    (request): z.infer<typeof sessionResponseSchema> => {
      const { user, expiresAt, csrfSecret } = requireAuth(request);
      return {
        user: { githubId: user.githubId, login: user.login, name: user.name, avatarUrl: user.avatarUrl },
        expiresAt: expiresAt.toISOString(),
        csrfToken: csrfToken(options.sessionSecret, csrfSecret),
      };
    },
  );
  done();
};
