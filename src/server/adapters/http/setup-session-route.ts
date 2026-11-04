// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import { SETUP_ERROR_CODES, setupSessionRoute, type unlockResponseSchema } from '../../../shared/setup.ts';
import { AppError } from './errors.ts';
import { readSetupCookie, setSetupCookie } from './setup-cookie.ts';
import { PUBLIC_NO_SESSION } from './setup-route-config.ts';
import type { SetupSessions } from './setup-sessions.ts';

/** The instance the route is registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

export interface SessionRouteOptions {
  readonly sessions: SetupSessions;
}

/**
 * `GET /api/setup/session` (E19-S07): the CSRF token of the setup session the cookie names. GitHub sends the browser back to
 * the setup page after a full-page round trip, and the page has lost the token the unlock answered with; the cookie, which
 * `SameSite=Strict` still sends on the requests the page itself makes, has not been lost. Without a live session it answers
 * `401 setup_locked`, as every setup request does. The cookie alone proves the session, as it does for the token's own
 * check: a page of another site cannot read the answer (no CORS header exists) and the browser does not send the cookie from
 * there. A passing request starts the idle time over, like every other one. Nothing of the session is logged.
 */
export function sessionRoute(app: Routes, options: SessionRouteOptions): void {
  app.get(
    setupSessionRoute.path,
    // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
    { schema: { response: setupSessionRoute.responses }, config: PUBLIC_NO_SESSION },
    (request, reply): z.infer<typeof unlockResponseSchema> => {
      const session = options.sessions.find(readSetupCookie(request));
      if (session === undefined) {
        throw new AppError(401, SETUP_ERROR_CODES.locked);
      }
      options.sessions.renew(session);
      setSetupCookie(reply, session.id);
      return { csrfToken: session.csrfToken };
    },
  );
}
