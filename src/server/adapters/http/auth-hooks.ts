// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Clock } from '../../services/ports/clock.ts';
import type { SessionStore } from '../db/sessions.ts';
import { readSessionCookie } from './session-cookie.ts';

// The hooks that turn the session cookie into `request.auth` (E10-S02) and keep `/api/auth` out of every cache; auth.ts
// registers them.

/**
 * Looks the session up for a request. A cookie that cannot be a session id never reaches the database. `touch` runs on
 * every authenticated request and is throttled by the store (E10-S01), so a busy page writes once a minute.
 */
export async function authenticate(request: FastifyRequest, store: SessionStore, clock: Clock): Promise<void> {
  const cookie = readSessionCookie(request.headers.cookie);
  request.sessionCookiePresented = cookie.kind !== 'absent';
  if (cookie.kind !== 'id') {
    return;
  }
  const now = clock.now();
  const found = await store.findLive(cookie.id, now);
  if (found === undefined) {
    return;
  }
  const session = await store.touch(found, now);
  request.auth = {
    user: session.user,
    sessionId: session.rowId,
    csrfSecret: session.csrfSecret,
    expiresAt: new Date(Math.min(session.idleExpiresAt.getTime(), session.absoluteExpiresAt.getTime())),
  };
}

/** `/api/auth`, alone, below it or with a query string; `/api/authors` is not under it. */
const AUTH_PATH = /^\/api\/auth(?:[/?]|$)/;

/**
 * Whether a request is addressed to `/api/auth` or below. The matched route is preferred to the raw URL, which can spell
 * the same route differently (`/api/%61uth/session`); an unmatched URL (a 404) has only the raw one.
 */
function isAuthRequest(request: FastifyRequest): boolean {
  return AUTH_PATH.test(request.routeOptions.url ?? request.url);
}

export function noStoreForAuth(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  if (isAuthRequest(request)) {
    reply.header('cache-control', 'no-store');
  }
  done();
}
