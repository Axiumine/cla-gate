// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { AUTH_ENV, TEST_SESSION_SECRET } from '../../../config/auth-fixture/test-support.ts';
import { FakeClock } from '../../../services/test-support.ts';
import { type LogCapture, PUBLIC_ROUTE, type TestAppOptions, testApp, testConfig } from '../../../test-support.ts';
import { loadMigrationFiles } from '../../db/migration-files.ts';
import { migrate } from '../../db/migrator.ts';
import { openPgliteDatabase } from '../../db/pglite.ts';
import type { Database } from '../../db/schema.ts';
import { createSessionStore, type SessionStore } from '../../db/sessions.ts';
import { MIGRATIONS_DIRECTORY } from '../../db/test-support.ts';
import { requireAuth } from '../auth-request.ts';
import { setSessionCookie } from '../session-cookie.ts';

// The app of the authentication tests (E10-S02): the real app on a migrated PGlite with the login settings, a clock the
// test moves by hand, people who are logged in, and a few probe routes that show what a route sees of the caller.

/** The instant the tests start at. */
const T0 = '2026-11-02T10:00:00.000Z';

/** The cookie's name, spelled out here on purpose: the tests assert the value the story specifies, not the constant. */
export const COOKIE_NAME = '__Host-cla_session';

/** A person with a session. `cookie` is what a browser sends. */
interface LoggedIn {
  /** `users.id`. */
  readonly userId: number;
  readonly githubId: number;
  /** The plain session id: 43 characters. */
  readonly id: string;
  /** `sessions.id`. */
  readonly sessionId: number;
  readonly csrfSecret: string;
  readonly cookie: string;
  /** The CSRF token the SPA would hold (E10-S03), computed here from the formula of the story, not by the code under test. */
  readonly token: string;
  /** What the SPA sends on a state-changing request (E10-S03): the session cookie, the app's own `Origin` and the token. */
  readonly headers: { readonly cookie: string; readonly origin: string; readonly 'x-csrf-token': string };
}

export interface AuthWorld {
  readonly app: FastifyInstance;
  readonly db: Kysely<Database>;
  readonly logs: LogCapture;
  readonly clock: FakeClock;
  /** The origin of `PUBLIC_BASE_URL`: the only `Origin` a state-changing request may carry. */
  readonly origin: string;
  /** Moves the clock forward by whole seconds. */
  readonly advance: (seconds: number) => void;
  readonly store: SessionStore;
  /** The kinds of the queries the app has sent since the test started (`SelectQueryNode`, `UpdateQueryNode`, ...). */
  readonly queries: string[];
  /** Creates the user (unless it exists) and a session for it, at the clock's time. */
  readonly login: (githubId: number) => Promise<LoggedIn>;
}

/** The token of a session under `secret` (the tests' `SESSION_SECRET` unless they rotate it), spelled out as the story specifies it: `base64url(hmac_sha256(secret, "csrf:" + csrf_secret))`. */
export function expectedToken(secret: string, csrfSecret: string): string {
  return crypto.createHmac('sha256', secret).update(`csrf:${csrfSecret}`).digest('base64url');
}

/**
 * The routes that show what a route sees of the caller, all `public`: the ones that need a caller ask for it themselves.
 * None that changes data is under `/api`, so none needs an audit declaration.
 * `/probe/mutate` answers every state-changing method and `/probe/safe` the methods the CSRF check never covers.
 */
function addProbeRoutes(app: FastifyInstance, absoluteSeconds: number): void {
  app.get('/probe/auth', PUBLIC_ROUTE, (request) => ({
    auth: request.auth,
    presented: request.sessionCookiePresented,
  }));
  app.get('/probe/protected', PUBLIC_ROUTE, (request) => ({ githubId: requireAuth(request).user.githubId }));
  app.get('/probe/set-cookie', PUBLIC_ROUTE, (_request, reply) => {
    setSessionCookie(reply, 'A'.repeat(43), absoluteSeconds);
    return 'ok';
  });
  app.route({
    method: ['POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/probe/mutate',
    ...PUBLIC_ROUTE,
    handler: (request) => ({ method: request.method, body: request.body ?? null }),
  });
  app.route({
    method: ['GET', 'OPTIONS'],
    url: '/probe/safe',
    ...PUBLIC_ROUTE,
    handler: (request) => ({ method: request.method }),
  });
  app.get('/api/auth/probe-boom', PUBLIC_ROUTE, () => {
    throw new Error('boom');
  });
}

/** Creates the user (unless it exists) and a session for it at the clock's time; what the person's browser would hold. */
async function loginAs(
  parts: {
    readonly base: Kysely<Database>;
    readonly store: SessionStore;
    readonly clock: FakeClock;
    readonly origin: string;
  },
  githubId: number,
): Promise<LoggedIn> {
  const { base, store, clock, origin } = parts;
  const user = await base
    .insertInto('users')
    .values({ github_id: githubId, login: `login-${githubId}`, name: `Name ${githubId}`, avatar_url: null })
    .onConflict((conflict) => conflict.column('github_id').doUpdateSet((eb) => ({ login: eb.ref('excluded.login') })))
    .returning('id')
    .executeTakeFirstOrThrow();
  const created = await store.create({ userId: user.id }, clock.now());
  const cookie = `${COOKIE_NAME}=${created.id}`;
  const token = expectedToken(TEST_SESSION_SECRET, created.csrfSecret);
  return {
    userId: user.id,
    githubId,
    id: created.id,
    sessionId: created.rowId,
    csrfSecret: created.csrfSecret,
    cookie,
    token,
    headers: { cookie, origin, 'x-csrf-token': token },
  };
}

/** The real app over a migrated PGlite. `env` adds to the login settings (the lifetimes, for instance). */
export async function authWorld(
  env: Readonly<Record<string, string>> = {},
  github: Pick<TestAppOptions, 'githubTimeoutMs' | 'fetch' | 'roleCache' | 'github'> = {},
): Promise<AuthWorld> {
  const base = await openPgliteDatabase();
  await migrate(base, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  const queries: string[] = [];
  const db = base.withPlugin({
    transformQuery: ({ node }) => {
      queries.push(node.kind);
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  });
  const clock = new FakeClock(T0);
  const allEnv = { ...AUTH_ENV, ...env };
  const { app, logs } = await testApp({ env: allEnv, db, clock, ...github });
  const config = testConfig(allEnv);
  addProbeRoutes(app, config.session.absoluteSeconds);
  const store = createSessionStore(base, config.session);
  const origin = new URL(config.publicBaseUrl).origin;
  return {
    app,
    origin,
    db: base,
    logs,
    clock,
    advance: (seconds) => {
      clock.advance(seconds * 1000);
    },
    store,
    queries,
    login: (githubId) => loginAs({ base, store, clock, origin }, githubId),
  };
}
