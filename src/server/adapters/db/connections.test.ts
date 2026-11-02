// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EventEmitter } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import pg from 'pg';
import { expect, test, vi } from 'vitest';
import {
  backendPid,
  blockedBackends,
  closeConnections,
  connectionsTo,
  emptyTestDatabase,
  expectBlocked,
  realPostgres,
  recordPoolErrors,
  requireTestDatabaseUrl,
  waitUntilBlocked,
  withConnections,
} from './test-support.ts';

// E20-S03: the parts of the concurrency harness that need no server. Connections are lazy, so a URL nothing listens
// on (port 1) is enough to build them; the tests that really use them are marked realPostgresOnly (concurrency.test.ts).

const NOTHING_LISTENS = 'postgres://user:pw@127.0.0.1:1/db';

test('the throw-away database URL is handed through, and its absence is explained', () => {
  expect(requireTestDatabaseUrl('postgres://a/b')).toBe('postgres://a/b');
  expect(() => requireTestDatabaseUrl(undefined)).toThrow(
    'withConnections needs a real Postgres server: mark the test with realPostgresOnly',
  );
});

test('withConnections opens connections on a real server and refuses to on PGlite', () => {
  const open = () => withConnections(2);
  if (realPostgres) {
    expect(open).not.toThrow();
  } else {
    expect(open).toThrow('withConnections needs a real Postgres server');
  }
});

test.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])('%s connections are refused', (count) => {
  expect(() => connectionsTo(NOTHING_LISTENS, count)).toThrow(RangeError);
  expect(() => connectionsTo(NOTHING_LISTENS, count)).toThrow('needs a positive whole number of connections');
});

test('each index gives its own connection, and an index outside the range is refused', () => {
  const connections = connectionsTo(NOTHING_LISTENS, 3);
  const members = [0, 1, 2].map((index) => connections.get(index));
  expect(new Set(members).size).toBe(3);
  expect(connections.get(1)).toBe(members[1]);
  expect(() => connections.get(3)).toThrow(new RangeError('there is no connection 3 among 3'));
  expect(() => connections.get(-1)).toThrow(new RangeError('there is no connection -1 among 3'));
});

test('every connection is closed once, by the cleanup that runs after each test', async () => {
  const connections = connectionsTo(NOTHING_LISTENS, 2);
  const closers = [0, 1].map((index) => vi.spyOn(connections.get(index), 'destroy'));
  await closeConnections();
  closers.forEach((destroy) => {
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  await closeConnections();
  closers.forEach((destroy) => {
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

/** A caller that arrives at `barrier` and notes `id` in `released` when it is let go. */
function arriveAt(barrier: () => Promise<void>, released: string[], id: string): Promise<void> {
  return barrier().then(() => {
    released.push(id);
  });
}

const alphabetically = (a: string, b: string): number => a.localeCompare(b);

test('the barrier holds every connection back until the last one arrives, then releases them together', async () => {
  const { barrier } = connectionsTo(NOTHING_LISTENS, 3);
  const released: string[] = [];
  const first = arriveAt(barrier, released, '1');
  const second = arriveAt(barrier, released, '2');
  await nextTurn();
  expect(released).toEqual([]);
  const third = arriveAt(barrier, released, '3');
  await Promise.all([first, second, third]);
  expect(released.toSorted(alphabetically)).toEqual(['1', '2', '3']);
});

test('the barrier can be used again: the next round waits for everyone once more', async () => {
  const { barrier } = connectionsTo(NOTHING_LISTENS, 2);
  const released: string[] = [];
  await Promise.all([arriveAt(barrier, released, '1a'), arriveAt(barrier, released, '1b')]);
  const early = arriveAt(barrier, released, '2a');
  await nextTurn();
  expect(released.toSorted(alphabetically)).toEqual(['1a', '1b']);
  await Promise.all([early, arriveAt(barrier, released, '2b')]);
  expect(released.toSorted(alphabetically)).toEqual(['1a', '1b', '2a', '2b']);
});

test('a barrier of one connection never holds anybody back', async () => {
  const { barrier } = connectionsTo(NOTHING_LISTENS, 1);
  await expect(barrier()).resolves.toBeUndefined();
  await expect(barrier()).resolves.toBeUndefined();
});

test('a pool error and an error of a checked-out client are both recorded, once each', () => {
  const pool = new pg.Pool({ connectionString: NOTHING_LISTENS });
  const sink: Error[] = [];
  recordPoolErrors(pool, sink);
  const idle = new Error('idle client died');
  pool.emit('error', idle);
  const client = new EventEmitter<{ error: [Error] }>();
  pool.emit('connect', client);
  const busy = new Error('checked-out client died');
  client.emit('error', busy);
  client.emit('error', idle);
  pool.emit('error', busy);
  expect(sink).toEqual([idle, busy]);
});

test('the pool errors of a connection group are exposed, empty until something fails', () => {
  expect(connectionsTo(NOTHING_LISTENS, 2).poolErrors).toEqual([]);
});

test('the backend id and the lock waiters can be read from any connection', async () => {
  const { db } = await emptyTestDatabase();
  expect(await backendPid(db)).toBeGreaterThan(0);
  expect(await blockedBackends(db)).toEqual([]);
});

test('a backend that is in the list of waiters is accepted, one that is not is named in the error', () => {
  expect(() => {
    expectBlocked([7, 9], 9);
  }).not.toThrow();
  expect(() => {
    expectBlocked([7, 9], 8);
  }).toThrow('backend 8 is not waiting for a lock (waiting: [7, 9])');
  expect(() => {
    expectBlocked([], 8);
  }).toThrow('backend 8 is not waiting for a lock (waiting: [])');
});

test('waiting for a backend that never blocks gives up with what was seen', async () => {
  const { db } = await emptyTestDatabase();
  await expect(waitUntilBlocked(db, 424_242, 50)).rejects.toThrow(
    'backend 424242 is not waiting for a lock (waiting: [])',
  );
});
