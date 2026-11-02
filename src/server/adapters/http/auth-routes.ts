// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { sessionResponseSchema } from '../../../shared/auth.ts';
import { requireAuth } from './auth-request.ts';
import { clearSessionCookie } from './session-cookie.ts';

/**
 * `GET /api/auth/session`: who the SPA is logged in as and until when. Without a live session it answers 401 and, when
 * the request did send a session cookie, clears it: a dead cookie would otherwise be sent, and refused, for ever.
 */
export const authRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    '/api/auth/session',
    // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
    { schema: { response: { 200: sessionResponseSchema } } },
    (request, reply): z.infer<typeof sessionResponseSchema> => {
      if (request.auth === null && request.sessionCookiePresented) {
        clearSessionCookie(reply);
      }
      const { user, expiresAt } = requireAuth(request);
      return {
        user: { githubId: user.githubId, login: user.login, name: user.name, avatarUrl: user.avatarUrl },
        expiresAt: expiresAt.toISOString(),
      };
    },
  );
  done();
};
