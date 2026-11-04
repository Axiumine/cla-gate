// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import {
  SETUP_ERROR_CODES,
  setupUnlockRoute,
  unlockRequestSchema,
  type unlockResponseSchema,
} from '../../../shared/setup.ts';
import type { Secret } from '../../config/secret.ts';
import { AppError } from './errors.ts';
import { SETUP_BODY_LIMIT } from './limits.ts';
import { parseInput } from './request-body.ts';
import { setSetupCookie } from './setup-cookie.ts';
import { sameSecret } from './setup-digest.ts';
import { SETUP_POST } from './setup-route-config.ts';
import type { SetupSessions } from './setup-sessions.ts';
import type { UnlockThrottle } from './setup-throttle.ts';

/** The instance the route is registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

export interface UnlockRouteOptions {
  /** The configured setup token. */
  readonly token: Secret;
  readonly sessions: SetupSessions;
  readonly throttle: UnlockThrottle;
}

/** The `429` of a client held back: `Retry-After` is the whole seconds until its oldest counted failure has left the window. */
function heldBack(reply: FastifyReply, seconds: number): AppError {
  // The reply is a thenable that settles when the response is sent: the result of `header` is dropped, never awaited.
  void reply.header('retry-after', String(seconds));
  return new AppError(429, 'too_many_requests');
}

/**
 * `POST /api/setup/unlock` (E19-S06): compares the SHA-256 digests of the token it was given and the configured one in
 * constant time, answers a wrong one with `401 invalid_setup_token` and counts it; past the limit of the throttle it answers
 * `429` before it reads the token, the right one included. A right token opens a session: the cookie and the CSRF token, in
 * the body (a `204` has no body to carry it). It logs and stores nothing of the token, the session or the CSRF token (the events
 * `setup.unlock.ok` and `setup.unlock.failed` of E19-S11 carry the request id and nothing else), and a body that is not
 * `{token}` is a `400` that no counter sees.
 */
export function unlockRoute(app: Routes, options: UnlockRouteOptions): void {
  app.post(
    setupUnlockRoute.path,
    // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
    { bodyLimit: SETUP_BODY_LIMIT, schema: { response: setupUnlockRoute.responses }, config: SETUP_POST },
    (request, reply): z.infer<typeof unlockResponseSchema> => {
      const wait = options.throttle.retryAfter(request.ip);
      if (wait !== undefined) {
        throw heldBack(reply, wait);
      }
      const { token } = parseInput(unlockRequestSchema, request.body);
      if (!sameSecret(options.token.reveal(), token)) {
        options.throttle.recordFailure(request.ip);
        request.log.warn('setup.unlock.failed');
        throw new AppError(401, SETUP_ERROR_CODES.invalidToken);
      }
      const session = options.sessions.open();
      setSetupCookie(reply, session.id);
      request.log.info('setup.unlock.ok');
      return { csrfToken: session.csrfToken };
    },
  );
}
