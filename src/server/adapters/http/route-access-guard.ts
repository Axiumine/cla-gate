// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';
import { declaredAccess } from './route-access.ts';
import { clearSessionCookie } from './session-cookie.ts';

// What the access declaration of a route (E11-S01) does at request time. The declarations themselves, and the check
// that every route has one, are in route-access.ts.

/**
 * The caller of a route that needs one: `requireAuth` of E10, which answers `401 unauthorized` when the request carries no
 * live session. A request that sent a session cookie that is dead has it cleared on the way out, so the browser stops
 * sending it.
 */
function requireCaller(request: FastifyRequest, reply: FastifyReply): void {
  if (request.auth === null && request.sessionCookiePresented) {
    clearSessionCookie(reply);
  }
  requireAuth(request);
}

/**
 * Acts on `config.access` for the request in hand: a `public` or `webhook` route is left alone (the webhook proves itself
 * by its HMAC), an `authenticated` route needs a live session and nothing else. `tenant` and `operator` routes need a
 * session too and are then refused with the uniform `404 not_found`: the guards that decide them (E11-S05, E11-S08) replace
 * that last step, and until they do no one gets through, which is also what a route with no valid declaration gets.
 */
function guardAccess(request: FastifyRequest, reply: FastifyReply): void {
  const { url, config } = request.routeOptions;
  // `url` is the route that matched, and undefined for a request no route answers (the 404 handler runs no route code).
  if (url === undefined) {
    return;
  }
  const access = declaredAccess(config.access);
  if (access === 'public' || access === 'webhook') {
    return;
  }
  requireCaller(request, reply);
  if (access !== 'authenticated') {
    throw new AppError(404, 'not_found');
  }
}

/**
 * Adds the `preHandler` that acts on `config.access`. Call it after `registerRequestGuards` (the `Origin` and CSRF checks of
 * E10-S03 come first, so a request from another site learns nothing about sessions) and before any route is registered.
 */
export function guardRouteAccess(app: FastifyInstance): void {
  app.addHook('preHandler', async (request, reply) => {
    guardAccess(request, reply);
  });
}
