// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type LoginFailureReason, loginFailedPath } from '../../../shared/auth.ts';
import { safeReturnTo } from '../../domain/return-to.ts';
import type { SessionLimits } from '../../domain/session.ts';
import { completeLogin, type LoginContext } from '../../services/login.ts';
import { clearOauthCookie, readOauthCookie } from './oauth-cookie.ts';
import { RATE_LIMITS, routeRateLimit } from './rate-limit.ts';
import { setSessionCookie } from './session-cookie.ts';

/** `code`, `state` and `error` are each at most this long: GitHub's are a few dozen characters, and the rest is hostile. */
const MAX_PARAMETER = 512;

const parameter = z.string().max(MAX_PARAMETER);

/**
 * What GitHub sends back: `code` and `state`, or `error` (`access_denied` when the person cancels) and `state`. Other
 * parameters (`error_description`, `error_uri`) are ignored. A repeated parameter is an array, which is not a string. The
 * query is parsed here and not by the route schema, because a bad one must end at the login-failed screen, not in a JSON 400.
 */
const callbackQuery = z.object({
  code: parameter.min(1).optional(),
  state: parameter.optional(),
  error: parameter.optional(),
});

/** Whether the state GitHub returned is the one in the cookie. Equal lengths first: `timingSafeEqual` throws on unequal ones. */
function sameState(expected: string, received: string | undefined): boolean {
  if (received === undefined) {
    return false;
  }
  const wanted = Buffer.from(expected);
  const given = Buffer.from(received);
  return wanted.length === given.length && timingSafeEqual(wanted, given);
}

type Outcome =
  | { readonly ok: true; readonly sessionId: string; readonly returnTo: string }
  | { readonly ok: false; readonly reason: LoginFailureReason };

const failure = (reason: LoginFailureReason): Outcome => ({ ok: false, reason });

interface CallbackRoutesOptions extends Omit<LoginContext, 'log'> {
  readonly limits: SessionLimits;
}

/**
 * Judges a callback: the query, then the attempt cookie and its state, then what GitHub said (a cancellation, or the
 * code), then the exchange. The cookie comes before everything GitHub said: without proof that this browser started the
 * login, nothing in the query is believed.
 */
async function complete(request: FastifyRequest, options: CallbackRoutesOptions): Promise<Outcome> {
  const query = callbackQuery.safeParse(request.query);
  if (!query.success) {
    return failure('bad_request');
  }
  const attempt = readOauthCookie(request, options.clock.now());
  if (attempt === undefined || !sameState(attempt.s, query.data.state)) {
    return failure('state_mismatch');
  }
  const { code, error } = query.data;
  if (error !== undefined) {
    return failure(error === 'access_denied' ? 'access_denied' : 'exchange_failed');
  }
  if (code === undefined) {
    return failure('bad_request');
  }
  const result = await completeLogin(
    { ...options, log: request.log },
    { code, verifier: attempt.v, presentedSessionRowId: request.auth?.sessionId },
  );
  // The path was checked when the attempt began; it is checked again because a redirect is the last place to be wrong.
  return result.ok
    ? { ok: true, sessionId: result.session.id, returnTo: safeReturnTo(attempt.r) }
    : failure(result.reason);
}

/**
 * `GET /api/auth/callback` (E10-S05): where GitHub sends the browser back. Every outcome clears the attempt cookie, so a
 * code is tried once from a given browser. A success answers with the new session's cookie and a redirect to the checked
 * return path; every failure is a redirect to the login-failed screen with a closed reason. This GET writes (a user row, a
 * session), which is the one write a GET may make: the login cannot be completed by any other request.
 */
export const callbackRoutes: FastifyPluginCallbackZod<CallbackRoutesOptions> = (app, options, done) => {
  app.get(
    '/api/auth/callback',
    { config: { rateLimit: routeRateLimit(RATE_LIMITS.callback) }, exposeHeadRoute: false },
    async (request, reply) => {
      clearOauthCookie(reply);
      const outcome = await complete(request, options);
      if (!outcome.ok) {
        request.log.info({ reason: outcome.reason }, 'auth.login_failed');
        return reply.redirect(loginFailedPath(outcome.reason));
      }
      setSessionCookie(reply, outcome.sessionId, options.limits.absoluteSeconds);
      return reply.redirect(outcome.returnTo);
    },
  );
  done();
};
