// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest } from 'fastify';

// Keeps `/api/auth` out of every cache (E10-S02). It is registered by `buildApp` ahead of the rate limit, and the answers
// that never reach a route (an invalid URL) set the header from {@link isAuthUrl}, so no answer under the path lacks it,
// whichever way the client spelled the target.

/** `/api/auth`, alone or below it; `/api/authors` is not under it. */
const AUTH_PATH = /^\/api\/auth(?:\/|$)/;

/** The scheme and authority of a target in absolute form (`http://host/api/auth/session`), which a proxy-style client sends. */
const ABSOLUTE_FORM = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i;

/** A percent escape, whether or not the rest of the URL is valid. */
const ESCAPE = /%([\da-f]{2})/gi;

/**
 * The path of a request target as the client spelled it, for a test that is deliberately generous: the scheme and
 * authority of an absolute-form target, the query and the fragment are dropped, and every well-formed escape is decoded
 * (a malformed one is left as it is, so an invalid URL still has a path). Decoding too much only adds a header to an
 * answer that is not under `/api/auth`, which is harmless; decoding too little would leave one without it.
 */
function pathOfTarget(url: string): string {
  const [path = ''] = url.replace(ABSOLUTE_FORM, '').split(/[?#]/, 1);
  return path.replace(ESCAPE, (_escape, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/** Whether a URL, as the client spelled it, is `/api/auth` or below it. */
export function isAuthUrl(url: string): boolean {
  return AUTH_PATH.test(pathOfTarget(url));
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
