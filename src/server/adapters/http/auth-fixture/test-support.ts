// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { AUTH_ENV } from '../../../config/auth-fixture/test-support.ts';
import { FakeClock } from '../../../services/test-support.ts';
import { type LogCapture, testApp, testConfig } from '../../../test-support.ts';
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
}

export interface AuthWorld {
  readonly app: FastifyInstance;
  readonly db: Kysely<Database>;
  readonly logs: LogCapture;
  readonly clock: FakeClock;
  /** Moves the clock forward by whole seconds. */
  readonly advance: (seconds: number) => void;
  readonly store: SessionStore;
  /** The kinds of the queries the app has sent since the test started (`SelectQueryNode`, `UpdateQueryNode`, ...). */
  readonly queries: string[];
  /** Creates the user (unless it exists) and a session for it, at the clock's time. */
  readonly login: (githubId: number) => Promise<LoggedIn>;
}

/** The routes that show what a route sees of the caller; all of them are GET, so none needs an audit declaration. */
function addProbeRoutes(app: FastifyInstance, absoluteSeconds: number): void {
  app.get('/probe/auth', (request) => ({ auth: request.auth, presented: request.sessionCookiePresented }));
  app.get('/probe/protected', (request) => ({ githubId: requireAuth(request).user.githubId }));
  app.get('/probe/set-cookie', (_request, reply) => {
    setSessionCookie(reply, 'A'.repeat(43), absoluteSeconds);
    return 'ok';
  });
  app.get('/api/auth/probe-boom', () => {
    throw new Error('boom');
  });
}

/** The real app over a migrated PGlite. `env` adds to the login settings (the lifetimes, for instance). */
export async function authWorld(env: Readonly<Record<string, string>> = {}): Promise<AuthWorld> {
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
  const { app, logs } = await testApp({ env: allEnv, db, clock });
  addProbeRoutes(app, testConfig(allEnv).session.absoluteSeconds);
  const store = createSessionStore(base, testConfig(allEnv).session);
  return {
    app,
    db: base,
    logs,
    clock,
    advance: (seconds) => {
      clock.advance(seconds * 1000);
    },
    store,
    queries,
    login: async (githubId) => {
      const user = await base
        .insertInto('users')
        .values({ github_id: githubId, login: `login-${githubId}`, name: `Name ${githubId}`, avatar_url: null })
        .onConflict((conflict) =>
          conflict.column('github_id').doUpdateSet((eb) => ({ login: eb.ref('excluded.login') })),
        )
        .returning('id')
        .executeTakeFirstOrThrow();
      const created = await store.create({ userId: user.id }, clock.now());
      return {
        userId: user.id,
        githubId,
        id: created.id,
        sessionId: created.rowId,
        csrfSecret: created.csrfSecret,
        cookie: `${COOKIE_NAME}=${created.id}`,
      };
    },
  };
}
