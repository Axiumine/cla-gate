// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { AuthSettings } from '../../config/auth.ts';
import type { Clock } from '../../services/ports/clock.ts';
import type { Database } from '../db/schema.ts';
import { createSessionStore } from '../db/sessions.ts';
import { createGithubLogin } from '../github/user-login.ts';
import { LOGIN_TIMEOUT_MS } from '../github/user-login-transport.ts';
import { callbackRoutes } from './auth-callback.ts';
import { authenticate } from './auth-hooks.ts';
import { loginRoutes } from './auth-login.ts';
import { logoutRoutes } from './auth-logout.ts';
import { authRoutes } from './auth-routes.ts';

// The login wiring (E10-S02, E10-S05, E10-S06): the cookie plugin, the session hook of auth-hooks.ts and the routes. The shape of
// `request.auth` and `requireAuth` are in auth-request.ts, the routes in auth-routes.ts, auth-login.ts, auth-callback.ts and auth-logout.ts,
// and the slot itself is declared with the request guards (E10-S03).

export interface AuthOptions {
  readonly db: Kysely<Database>;
  readonly settings: AuthSettings;
  readonly clock: Clock;
  /** How the login reaches GitHub (E10-S05); defaults to the global `fetch`. Tests intercept it with MSW. */
  readonly fetch?: typeof fetch | undefined;
  /** The ceiling of each call to GitHub during the login; defaults to 10 seconds. */
  readonly githubTimeoutMs?: number | undefined;
}

/**
 * Registers the cookie plugin (signing with `SESSION_SECRET`), the session hook and the routes of `/api/auth`. Called by
 * `buildApp` only when the login is configured (E10-S01).
 */
export async function registerAuth(app: FastifyInstance, options: AuthOptions): Promise<void> {
  const store = createSessionStore(options.db, options.settings.session);
  await app.register(fastifyCookie, { secret: options.settings.sessionSecret.reveal() });
  app.decorateRequest('sessionCookiePresented', false);
  app.addHook('onRequest', (request) => authenticate(request, store, options.clock));
  await app.register(authRoutes, { sessionSecret: options.settings.sessionSecret });
  await app.register(loginRoutes, {
    clientId: options.settings.clientId,
    callbackUrl: options.settings.callbackUrl,
    clock: options.clock,
  });
  const { settings } = options;
  const github = createGithubLogin({
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    redirectUri: settings.callbackUrl,
    timeoutMs: options.githubTimeoutMs ?? LOGIN_TIMEOUT_MS,
    fetch: options.fetch,
  });
  await app.register(callbackRoutes, { db: options.db, github, limits: settings.session, clock: options.clock });
  await app.register(logoutRoutes, { store });
}
