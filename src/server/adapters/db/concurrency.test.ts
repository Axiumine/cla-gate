// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import type { Database } from './schema.ts';
import {
  backendPid,
  blockedBackends,
  emptyTestDatabase,
  realPostgresOnly,
  waitUntilBlocked,
  withConnections,
} from './test-support.ts';

// E20-S03: self-tests of the concurrency harness. Only a real server can show them (PGlite has one session), so they
// are skipped on PGlite and run in the CI `postgres` job. Interleavings are decided by a barrier or by `pg_locks`,
// never by a timer.

const sqlState = z.object({ code: z.string() });

/** `ok` when `attempt` succeeds, else the SQLSTATE of its failure. */
async function outcomeOf(attempt: PromiseLike<unknown>): Promise<string> {
  try {
    await attempt;
    return 'ok';
  } catch (error) {
    return sqlState.safeParse(error).data?.code ?? `no SQLSTATE: ${String(error)}`;
  }
}

// The attempts are built inside the test: a rejected promise made while the table is collected would be unhandled.
test.each([
  ['a statement that succeeds', () => Promise.resolve(1), 'ok'],
  ['a unique violation', () => Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' })), '23505'],
  [
    'a failure without a SQLSTATE',
    () => Promise.reject(new Error('socket closed')),
    'no SQLSTATE: Error: socket closed',
  ],
])('outcomeOf names %s', async (_name, attempt, expected) => {
  await expect(outcomeOf(attempt())).resolves.toBe(expected);
});

// ------------------------------------------------------------------------------------------ the unique-index race

/** The shape of `signatures_active_unique`: unique on three columns, only for rows that are not revoked. */
async function createClaims(db: Kysely<Database>): Promise<void> {
  await sql`create table claims (user_id integer, document_id integer, major integer, revoked_at timestamptz)`.execute(
    db,
  );
  await sql`create unique index claims_active_unique on claims (user_id, document_id, major)
    where revoked_at is null`.execute(db);
}

const claim = (db: Kysely<Database>) =>
  sql`insert into claims (user_id, document_id, major) values (1, 1, 1)`.execute(db);

async function claimCount(db: Kysely<Database>): Promise<number> {
  const { rows } = await sql<{ n: number }>`select count(*)::int as n from claims`.execute(db);
  return rows[0]?.n ?? -1;
}

realPostgresOnly(
  'two connections inserting the same active key at once: exactly one wins, one gets 23505',
  async () => {
    const { db } = await emptyTestDatabase();
    await createClaims(db);
    const connections = withConnections(2);
    const outcomes = await Promise.all(
      [0, 1].map(async (index) => {
        await connections.barrier();
        return outcomeOf(claim(connections.get(index)));
      }),
    );
    expect(outcomes.toSorted((a, b) => a.localeCompare(b))).toEqual(['23505', 'ok']);
    expect(await claimCount(db)).toBe(1);
  },
);

/** `winner` inserts first and keeps its transaction open; `loser` then waits in `pg_locks` and fails once `winner` commits. */
async function loserFailsWithDuplicate(winner: 0 | 1): Promise<void> {
  const { db } = await emptyTestDatabase();
  await createClaims(db);
  const connections = withConnections(2);
  const first = connections.get(winner);
  const second = connections.get(winner === 0 ? 1 : 0);
  const waiter = await backendPid(second);
  await sql`begin`.execute(first);
  await claim(first);
  const attempt = outcomeOf(claim(second));
  await waitUntilBlocked(db, waiter);
  await sql`commit`.execute(first);
  expect(await attempt).toBe('23505');
  expect(await claimCount(db)).toBe(1);
}

realPostgresOnly('the first connection wins and the second gets 23505', () => loserFailsWithDuplicate(0));

realPostgresOnly('the second connection wins and the first gets 23505', () => loserFailsWithDuplicate(1));

realPostgresOnly('a revoked row does not hold the key: the active insert succeeds next to it', async () => {
  const { db } = await emptyTestDatabase();
  await createClaims(db);
  const connections = withConnections(2);
  await sql`insert into claims values (1, 1, 1, now())`.execute(connections.get(0));
  await expect(claim(connections.get(1))).resolves.toBeDefined();
  expect(await claimCount(db)).toBe(2);
});

// -------------------------------------------------------------------------------------------------- the lock wait

realPostgresOnly(
  'a row lock held by A blocks B in pg_locks until A commits, then B sees the committed value',
  async () => {
    const { db } = await emptyTestDatabase();
    await sql`create table counters (id integer primary key, value integer not null)`.execute(db);
    await sql`insert into counters values (1, 10)`.execute(db);
    const connections = withConnections(2);
    const a = connections.get(0);
    const b = connections.get(1);
    await sql`begin`.execute(a);
    await sql`select value from counters where id = 1 for update`.execute(a);
    // The pid is read before B blocks: a connection that waits on a lock cannot answer another query.
    const waiter = await backendPid(b);

    let proceeded = false;
    const waiting = sql<{ value: number }>`select value from counters where id = 1 for update`
      .execute(b)
      .then((result) => {
        proceeded = true;
        return result;
      });
    await waitUntilBlocked(db, waiter);
    expect(proceeded).toBe(false);

    await sql`update counters set value = 11 where id = 1`.execute(a);
    await sql`commit`.execute(a);
    expect((await waiting).rows).toEqual([{ value: 11 }]);
    expect(await blockedBackends(db)).toEqual([]);
  },
);

// ----------------------------------------------------------------------------------------------- failure injection

realPostgresOnly(
  'a backend terminated in the middle of a transaction: an error, no partial rows, a fresh connection works',
  async () => {
    const { db } = await emptyTestDatabase();
    await sql`create table ledger (id integer primary key, note text not null)`.execute(db);
    const connections = withConnections(2);
    const victim = connections.get(0);
    const killer = connections.get(1);

    await sql`begin`.execute(victim);
    await sql`insert into ledger values (1, 'never committed')`.execute(victim);
    const doomed = await backendPid(victim);
    await expect(sql`select pg_terminate_backend(${doomed}) as terminated`.execute(killer)).resolves.toMatchObject({
      rows: [{ terminated: true }],
    });

    await vi.waitFor(() => {
      expect(connections.poolErrors.map((error) => error.message)).toEqual([
        expect.stringContaining('terminating connection due to administrator command'),
      ]);
    });
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from ledger`.execute(killer);
    expect(rows).toEqual([{ n: 0 }]);
    const fresh = await backendPid(victim);
    expect(fresh).not.toBe(doomed);
    await expect(outcomeOf(sql`insert into ledger values (2, 'on a fresh connection')`.execute(victim))).resolves.toBe(
      'ok',
    );
    expect((await sql<{ n: number }>`select count(*)::int as n from ledger`.execute(db)).rows).toEqual([{ n: 1 }]);
  },
);

// ------------------------------------------------------------------------------------------------ the connections

realPostgresOnly('withConnections gives independent backends that all live in the throw-away database', async () => {
  const connections = withConnections(3);
  const sessions = await Promise.all(
    [0, 1, 2].map(async (index) => {
      const db = connections.get(index);
      const { rows } = await sql<{ pid: number; name: string }>`
        select pg_backend_pid() as pid, current_database() as name`.execute(db);
      return { first: rows[0], again: await backendPid(db) };
    }),
  );
  expect(new Set(sessions.map((session) => session.first?.pid)).size).toBe(3);
  expect(sessions.map((session) => session.first?.pid)).toEqual(sessions.map((session) => session.again));
  expect(sessions.map((session) => session.first?.name)).toEqual([
    expect.stringMatching(/^cla_test_[0-9a-f]{12}$/),
    expect.stringMatching(/^cla_test_[0-9a-f]{12}$/),
    expect.stringMatching(/^cla_test_[0-9a-f]{12}$/),
  ]);
});
