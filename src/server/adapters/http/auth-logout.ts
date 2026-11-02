// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { logoutRequestSchema } from '../../../shared/auth.ts';
import type { RoleCache } from '../../services/role-cache.ts';
import type { SessionStore } from '../db/sessions.ts';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';
import { RATE_LIMITS, routeRateLimit } from './rate-limit.ts';
import { clearSessionCookie } from './session-cookie.ts';

interface LogoutRoutesOptions {
  readonly store: SessionStore;
  /** The cache of what GitHub said the caller may do (E11-S04): logout makes the next request ask again. */
  readonly roles: Pick<RoleCache, 'invalidateViewer'>;
}

/**
 * `POST /api/auth/logout` (E10-S06): ends the session in use, or with `{ "everywhere": true }` every session of the
 * caller, clears the cookie and answers 204. The Origin, session and CSRF token checks of E10-S03 have run before this
 * handler, so a request that reaches it is the caller's own page. The body is parsed here and not by a route schema, which
 * Fastify runs before those checks: a request from another site learns nothing of how its body was read. The user comes
 * from `request.auth` and never from the body (the schema is strict, so a `userId` in it is a 400): another person's
 * sessions cannot be named. No GitHub token is
 * stored (E10-S05), so there is nothing to revoke and nothing to call. The roles cached for the caller (E11-S04) are
 * forgotten, in both forms of logout, so the caller's next request asks GitHub again. Logout changes no tenant data, hence
 * `auditExempt: 'session'` (E04-S09). The log line carries the flag and, for everywhere, the count, never an id or a login.
 */
export const logoutRoutes: FastifyPluginCallbackZod<LogoutRoutesOptions> = (app, options, done) => {
  app.post(
    '/api/auth/logout',
    { config: { access: 'authenticated', auditExempt: 'session', rateLimit: routeRateLimit(RATE_LIMITS.logout) } },
    async (request, reply) => {
      const { sessionId, user } = requireAuth(request);
      const body = logoutRequestSchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'bad_request');
      }
      const everywhere = body.data?.everywhere === true;
      if (everywhere) {
        const removed = await options.store.removeAllOfUser(user.id);
        request.log.info({ everywhere, removed }, 'auth.logout');
      } else {
        await options.store.remove(sessionId);
        request.log.info({ everywhere }, 'auth.logout');
      }
      options.roles.invalidateViewer(user.githubId);
      clearSessionCookie(reply);
      return reply.code(204).send();
    },
  );
  done();
};
