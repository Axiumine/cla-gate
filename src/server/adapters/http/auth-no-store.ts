// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest } from 'fastify';

// Keeps `/api/auth` out of every cache (E10-S02). It is registered by `buildApp` ahead of the rate limit, and the answers
// that never reach a route (an invalid URL) set the header from {@link isAuthUrl}, so no answer under the path lacks it.

/** `/api/auth`, alone, below it or with a query string; `/api/authors` is not under it. */
const AUTH_PATH = /^\/api\/auth(?:[/?]|$)/;

/** Whether a URL, as the client spelled it, is `/api/auth` or below it. */
export function isAuthUrl(url: string): boolean {
  return AUTH_PATH.test(url);
}

/**
 * Whether a request is addressed to `/api/auth` or below. The matched route is preferred to the raw URL, which can spell
 * the same route differently (`/api/%61uth/session`); an unmatched URL (a 404) has only the raw one.
 */
function isAuthRequest(request: FastifyRequest): boolean {
  return isAuthUrl(request.routeOptions.url ?? request.url);
}

export function noStoreForAuth(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  if (isAuthRequest(request)) {
    reply.header('cache-control', 'no-store');
  }
  done();
}
