// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { AuthSettings } from '../../config/auth.ts';
import type { Clock } from '../../services/ports/clock.ts';
import type { Database } from '../db/schema.ts';
import { createSessionStore, type SessionStore } from '../db/sessions.ts';
import { loginRoutes } from './auth-login.ts';
import { authRoutes } from './auth-routes.ts';
import { readSessionCookie } from './session-cookie.ts';

// The hooks that turn the session cookie into `request.auth` (E10-S02); the shape of `request.auth` and `requireAuth` are in
// auth-request.ts, the routes in auth-routes.ts, and the slot itself is declared with the request guards (E10-S03).

/**
 * Looks the session up for a request. A cookie that cannot be a session id never reaches the database. `touch` runs on
 * every authenticated request and is throttled by the store (E10-S01), so a busy page writes once a minute.
 */
async function authenticate(request: FastifyRequest, store: SessionStore, clock: Clock): Promise<void> {
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

function noStoreForAuth(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  if (isAuthRequest(request)) {
    reply.header('cache-control', 'no-store');
  }
  done();
}

export interface AuthOptions {
  readonly db: Kysely<Database>;
  readonly settings: AuthSettings;
  readonly clock: Clock;
}

/**
 * Registers the cookie plugin (signing with `SESSION_SECRET`), the hooks and the routes of `/api/auth`. Called by
 * `buildApp` only when the login is configured (E10-S01).
 */
export async function registerAuth(app: FastifyInstance, options: AuthOptions): Promise<void> {
  const store = createSessionStore(options.db, options.settings.session);
  await app.register(fastifyCookie, { secret: options.settings.sessionSecret.reveal() });
  app.decorateRequest('sessionCookiePresented', false);
  app.addHook('onRequest', noStoreForAuth);
  app.addHook('onRequest', (request) => authenticate(request, store, options.clock));
  await app.register(authRoutes, { sessionSecret: options.settings.sessionSecret });
  await app.register(loginRoutes, { clientId: options.settings.clientId, callbackUrl: options.settings.callbackUrl });
}
