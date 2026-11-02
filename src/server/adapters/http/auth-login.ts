// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { safeReturnTo } from '../../domain/return-to.ts';
import type { Clock } from '../../services/ports/clock.ts';
import { authorizeUrl, newLoginAttempt } from './oauth-attempt.ts';
import { setOauthCookie } from './oauth-cookie.ts';

interface LoginRoutesOptions {
  /** The GitHub App's client id. */
  readonly clientId: string;
  /** `callbackUrl(config)`: the `redirect_uri` of the authorize request. */
  readonly callbackUrl: string;
  /** Where the attempt cookie takes its start time from. */
  readonly clock: Clock;
}

/**
 * Whatever arrives in `return_to` is accepted here and judged by `safeReturnTo`, which never refuses: a missing value,
 * a repeated one (an array) or a hostile one all end at `/`.
 */
const loginQuery = z.object({ return_to: z.string().optional().catch(undefined) });

/**
 * `GET /api/auth/login?return_to=<path>` (E10-S04): the start of the login. It writes nothing to the database and reads
 * only the session lookup the request hook already did. A person who is logged in goes straight to the checked path, with
 * no cookie and no round trip to GitHub; anyone else gets the attempt cookie and a redirect to GitHub's authorize page.
 */
export const loginRoutes: FastifyPluginCallbackZod<LoginRoutesOptions> = (app, options, done) => {
  app.get('/api/auth/login', { schema: { querystring: loginQuery } }, (request, reply) => {
    const returnTo = safeReturnTo(request.query.return_to);
    if (request.auth !== null) {
      return reply.redirect(returnTo);
    }
    const attempt = newLoginAttempt();
    setOauthCookie(reply, { s: attempt.state, v: attempt.verifier, r: returnTo }, options.clock.now());
    return reply.redirect(
      authorizeUrl({
        clientId: options.clientId,
        redirectUri: options.callbackUrl,
        state: attempt.state,
        challenge: attempt.challenge,
      }),
    );
  });
  done();
};
