// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Secret } from '../../config/secret.ts';
import { requireAuth } from './auth-request.ts';
import { csrfProblem, skipsCsrfCheck } from './csrf-routes.ts';
import { csrfTokenMatches } from './csrf-token.ts';
import { AppError } from './errors.ts';

// What every state-changing request must prove (E10-S03): that it comes from our own page. The order is fixed: the
// `Origin` header, then a live session, then the CSRF token; JSON is the only body a route reads.

interface RequestGuardOptions {
  /** `PUBLIC_BASE_URL`: the one origin a state-changing request may come from. */
  readonly publicBaseUrl: string;
  /** Undefined when login is not configured: no session exists then, so no request passes the session step. */
  readonly sessionSecret: Secret | undefined;
}

/**
 * Thrown while a route is being registered, so an app with a route outside the CSRF check that is not on the list cannot start.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export class CsrfRouteError extends Error {
  override readonly name = 'CsrfRouteError';
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Only `application/json` has a parser, so a body of any other type, or of none, is refused before a route sees it. A
 * request that no route answers is left to the 404 handler without reading its body, as Fastify does when no parser
 * matches.
 */
function refuseMediaType(request: FastifyRequest, _payload: unknown, done: (error: Error | null) => void): void {
  done(request.is404 ? null : new AppError(415, 'unsupported_media_type'));
}

/**
 * Registers, on `app` and everything registered after this call: the `request.auth` slot (null until the session hook
 * fills it), the JSON-only content type parsing, the registration check of `config.csrf` and the `preHandler` that
 * checks `Origin`, session and token on POST, PUT, PATCH and DELETE. GET, HEAD and OPTIONS are never checked. It is called
 * whether or not login is configured, so no state-changing route is ever unguarded.
 */
export function registerRequestGuards(app: FastifyInstance, options: RequestGuardOptions): void {
  const origin = new URL(options.publicBaseUrl).origin;
  app.decorateRequest('auth', null);
  // The default `text/plain` parser goes, and a catch-all refuses what is left; `application/json` keeps its parser.
  app.removeContentTypeParser('text/plain');
  app.addContentTypeParser('*', refuseMediaType);
  app.addHook('onRoute', (route) => {
    const problem = csrfProblem(route.method, route.url, route.config);
    if (problem !== undefined) {
      throw new CsrfRouteError(problem);
    }
  });
  // eslint-disable-next-line @typescript-eslint/require-await -- an async hook is how a Fastify hook throws; a sync one-argument hook never finishes
  app.addHook('preHandler', async (request) => {
    // `url` is the route that matched, and undefined for a request no route answers (the 404 handler runs no route code).
    const { url, config } = request.routeOptions;
    if (url === undefined || !STATE_CHANGING.has(request.method) || skipsCsrfCheck(request.method, url, config)) {
      return;
    }
    if (request.headers.origin !== origin) {
      throw new AppError(403, 'origin_not_allowed');
    }
    const { csrfSecret } = requireAuth(request);
    const key = options.sessionSecret;
    if (key === undefined || !csrfTokenMatches(key, csrfSecret, request.headers['x-csrf-token'])) {
      throw new AppError(403, 'csrf_invalid');
    }
  });
}
