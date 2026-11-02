// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterEach, inject, vi } from 'vitest';
import { typeParser } from '../pg.ts';
import type { Database } from '../schema.ts';

// Independent connections to the throw-away database of a real-Postgres run, for tests of races and lock waits (E20-S03).
// `../test-support.ts` re-exports everything here: a test imports from that file and nothing else.

const NO_DATABASE_URL = 'withConnections needs a real Postgres server: mark the test with realPostgresOnly';

/** The URL of the throw-away `cla_test_<hex>` database of this run, or a message that says why there is none. */
export function requireTestDatabaseUrl(url: string | undefined): string {
  if (url === undefined) {
    throw new Error(NO_DATABASE_URL);
  }
  return url;
}

/**
 * A reusable barrier: the call that completes a group of `parties` releases every call of the group at once, and the
 * next call starts a new group. Interleavings are decided by who reaches the barrier, never by a timer.
 */
function createBarrier(parties: number): () => Promise<void> {
  let group: PromiseWithResolvers<void> = Promise.withResolvers();
  let arrived = 0;
  return () => {
    const released = group.promise;
    arrived += 1;
    if (arrived === parties) {
      arrived = 0;
      const completed = group;
      group = Promise.withResolvers();
      completed.resolve();
    }
    return released;
  };
}

/**
 * Sends the errors of `pool` to `sink`: an idle client whose backend died (the pool's own `error` event) and a client
 * that is checked out when it dies, which neither node-postgres' pool nor Kysely listen to (an unhandled `error` event
 * would crash the worker). One failure is recorded once, although both events can report it.
 */
export function recordPoolErrors(pool: pg.Pool, sink: Error[]): void {
  const record = (error: Error): void => {
    if (!sink.includes(error)) {
      sink.push(error);
    }
  };
  pool.on('error', record);
  pool.on('connect', (client) => {
    client.on('error', record);
  });
}

export interface Connections {
  /**
   * Connection `index` (from 0): a Kysely over a pool of exactly one connection that is never closed for being idle,
   * so every statement sent through it runs in the same backend session. `begin`, statements and `commit` can be sent
   * one by one, and a statement that blocks on a lock leaves the other connections free.
   */
  readonly get: (index: number) => Kysely<Database>;
  /** Errors the pools of these connections surfaced outside a query, such as a backend terminated while idle. */
  readonly poolErrors: readonly Error[];
  /** Resolves, for all connections at once, when every one of them has called it; reusable for the next round. */
  readonly barrier: () => Promise<void>;
}

const sessions: Kysely<Database>[] = [];

/** Closes every connection opened so far. Runs after each test, so a test never closes its own connections. */
export async function closeConnections(): Promise<void> {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()));
}

afterEach(closeConnections);

/** Nothing connects until the first query. Every connection is closed after the current test. */
export function connectionsTo(url: string, count: number): Connections {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`withConnections needs a positive whole number of connections, got ${count}`);
  }
  const poolErrors: Error[] = [];
  const members = Array.from({ length: count }, () => {
    const pool = new pg.Pool({
      connectionString: url,
      max: 1,
      idleTimeoutMillis: 0,
      connectionTimeoutMillis: 5000,
      types: { getTypeParser: typeParser },
    });
    recordPoolErrors(pool, poolErrors);
    return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  });
  sessions.push(...members);
  const byIndex = new Map(members.map((member, index) => [index, member]));
  return {
    get: (index) => {
      const member = byIndex.get(index);
      if (member === undefined) {
        throw new RangeError(`there is no connection ${index} among ${members.length}`);
      }
      return member;
    },
    poolErrors,
    barrier: createBarrier(count),
  };
}

/**
 * `count` independent connections to the throw-away `cla_test_<hex>` database of this run (never to the database
 * `DATABASE_URL` names), for tests of races and lock waits. Needs a real server: call it only from a test that is
 * marked with {@link realPostgresOnly}.
 */
export function withConnections(count: number): Connections {
  return connectionsTo(requireTestDatabaseUrl(inject('testDatabaseUrl')), count);
}

/** The process id of the backend that serves `db`. */
export async function backendPid(db: Kysely<Database>): Promise<number> {
  const { pid } = await db.selectNoFrom(sql<number>`pg_backend_pid()`.as('pid')).executeTakeFirstOrThrow();
  return pid;
}

/** The backends that wait for a lock right now: the `pg_locks` rows that are not granted. */
export async function blockedBackends(observer: Kysely<Database>): Promise<number[]> {
  const waiting = sql<
    number[]
  >`coalesce((select array_agg(distinct pid order by pid) from pg_locks where not granted), '{}')`;
  const { pids } = await observer.selectNoFrom(waiting.as('pids')).executeTakeFirstOrThrow();
  return pids;
}

/** Throws unless `pid` is among the `blocked` backends. */
export function expectBlocked(blocked: readonly number[], pid: number): void {
  if (!blocked.includes(pid)) {
    throw new Error(`backend ${pid} is not waiting for a lock (waiting: [${blocked.join(', ')}])`);
  }
}

const BLOCKED_TIMEOUT_MS = 10_000;

/** Polls `pg_locks` through `observer` until backend `pid` waits for a lock; rejects with the last observation after `timeoutMs`. */
export function waitUntilBlocked(
  observer: Kysely<Database>,
  pid: number,
  timeoutMs = BLOCKED_TIMEOUT_MS,
): Promise<void> {
  return vi.waitFor(
    async () => {
      expectBlocked(await blockedBackends(observer), pid);
    },
    { timeout: timeoutMs, interval: 10 },
  );
}
