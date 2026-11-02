// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from './auth-request.ts';
import { AppError } from './errors.ts';
import { declaredAccess } from './route-access.ts';
import { clearSessionCookie } from './session-cookie.ts';
import { guardTenant, type TenantGuardDeps } from './tenant-guard.ts';

// What the access declaration of a route (E11-S01) does at request time. The declarations themselves, and the check
// that every route has one, are in route-access.ts; the guard of a tenant route (E11-S05) is in tenant-guard.ts.

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
 * by its HMAC), an `authenticated` route needs a live session and nothing else, and a `tenant` route needs one and then
 * passes the guard of E11-S05 (the resolver, the role and the state of the tenant). An `operator` route needs a session too
 * and is then refused with the uniform `404 not_found`: the guard that decides it (E11-S08) replaces that last step, and
 * until it does no one gets through, which is also what a route with no valid declaration gets.
 */
async function guardAccess(request: FastifyRequest, reply: FastifyReply, tenant: TenantGuardDeps): Promise<void> {
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
  if (typeof access === 'object') {
    await guardTenant(tenant, request, access);
  } else if (access !== 'authenticated') {
    throw new AppError(404, 'not_found');
  }
}

/**
 * Adds the `preHandler` that acts on `config.access`, and the `request.tenant` slot a tenant route's guard fills. Call it
 * after `registerRequestGuards` (the `Origin` and CSRF checks of E10-S03 come first, so a request from another site learns
 * nothing about sessions) and before any route is registered.
 */
export function guardRouteAccess(app: FastifyInstance, tenant: TenantGuardDeps): void {
  app.decorateRequest('tenant', null);
  app.addHook('preHandler', async (request, reply) => {
    await guardAccess(request, reply, tenant);
  });
}
