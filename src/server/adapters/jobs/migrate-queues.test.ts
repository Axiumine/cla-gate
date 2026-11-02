// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, onTestFinished, test, vi } from 'vitest';
import { UNREACHABLE_DATABASE_URL } from '../../test-support.ts';
import { openPgliteDatabase } from '../db/pglite.ts';
import { emptyTestDatabase, ensureRuntimeRole } from '../db/test-support.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { QUEUES } from './queues.ts';
import { fakeBoss } from './test-support.ts';

// The queue step of `yarn db:migrate` with a pg-boss that is only a script, on PGlite for the grants (E07-S01). Against a
// real server: queue-real.test.ts.

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- made-up value: the tests only look at how the options are built
const OWNER_URL = 'postgres://cla_owner:made-up-pw@127.0.0.1:1/cla';
const NO_WAIT = { intervalMs: 1, attempts: 2, sleep: () => Promise.resolve() };

/**
 * A database with the pgboss schema (a stand-in: the fake boss installs nothing). With the runtime role, the shared test
 * database; without it a fresh PGlite, because on a real server the role is cluster-wide and other tests create it.
 */
async function database(options: { readonly runtimeRole: boolean }) {
  const db = options.runtimeRole ? (await emptyTestDatabase()).db : await openPgliteDatabase();
  if (!options.runtimeRole) {
    onTestFinished(async () => {
      await db.destroy();
    });
  }
  await sql`drop schema if exists pgboss cascade`.execute(db);
  await sql`create schema pgboss`.execute(db);
  await sql`create table pgboss.job (id integer)`.execute(db);
  if (options.runtimeRole) {
    await ensureRuntimeRole(db);
  }
  return db;
}

async function migrateWith(boss = fakeBoss(), runtimeRole = true) {
  const db = await database({ runtimeRole });
  const onError = vi.fn();
  const createBoss = vi.fn(() => boss);
  const result = await migrateJobQueues({
    connectionString: OWNER_URL,
    db,
    onError,
    createBoss,
    indexBuildWait: NO_WAIT,
  });
  return { result, db, onError, createBoss, boss };
}

test('it starts pg-boss with the options of the owner and creates every queue that is missing, in the order of the constant', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([]);
  const { result, createBoss } = await migrateWith(boss);
  expect(createBoss).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ connectionString: OWNER_URL, migrate: true, createSchema: true, supervise: false }),
  );
  expect(boss.createQueue.mock.calls.map(([name]) => name)).toEqual([...QUEUES]);
  expect(result.created).toEqual([...QUEUES]);
});

test('it creates only the queues that do not exist: a run on a migrated database creates none', async () => {
  const boss = fakeBoss();
  const { result } = await migrateWith(boss);
  expect(boss.createQueue).not.toHaveBeenCalled();
  expect(result.created).toEqual([]);
});

test('with some queues present it creates the others', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([{ name: 'evaluate-pr' }, { name: 'sweep' }]);
  const { result } = await migrateWith(boss);
  expect(result.created).not.toContain('sweep');
  expect(result.created).toHaveLength(QUEUES.length - 2);
  expect(boss.createQueue).not.toHaveBeenCalledWith('evaluate-pr');
});

test('the errors pg-boss reports on its own connections go to the sink it was given', async () => {
  const boss = fakeBoss();
  const { onError } = await migrateWith(boss);
  boss.emitError(new Error('connection reset'));
  expect(onError).toHaveBeenCalledExactlyOnceWith(new Error('connection reset'));
});

test('it waits for the index builds a migration queued before it lets go of pg-boss, then stops it', async () => {
  const boss = fakeBoss();
  boss.getBamStatus.mockResolvedValueOnce([{ status: 'pending', count: 1 }]).mockResolvedValueOnce([]);
  await migrateWith(boss);
  expect(boss.getBamStatus).toHaveBeenCalledTimes(2);
  expect(boss.getBamStatus.mock.invocationCallOrder[1]).toBeLessThan(boss.stop.mock.invocationCallOrder[0] ?? 0);
});

test('it grants the runtime role last, when the role exists', async () => {
  const { result, db } = await migrateWith();
  expect(result.grants).toBe('granted');
  const { rows } = await sql<{
    ok: boolean;
  }>`select has_table_privilege('cla_app', 'pgboss.job', 'INSERT') as ok`.execute(db);
  expect(rows).toEqual([{ ok: true }]);
});

test('without the runtime role the grants are skipped, and that is reported', async () => {
  const { result } = await migrateWith(fakeBoss(), false);
  expect(result.grants).toBe('skipped');
});

test.each([
  [
    'pg-boss cannot start',
    (boss: ReturnType<typeof fakeBoss>) => boss.start.mockRejectedValueOnce(new Error('no database')),
  ],
  [
    'a queue cannot be created',
    (boss: ReturnType<typeof fakeBoss>) => {
      boss.getQueues.mockResolvedValueOnce([]);
      boss.createQueue.mockRejectedValueOnce(new Error('permission denied'));
    },
  ],
  [
    'an index build failed',
    (boss: ReturnType<typeof fakeBoss>) => boss.getBamStatus.mockResolvedValueOnce([{ status: 'failed', count: 1 }]),
  ],
])('when %s the step fails with that error and pg-boss is stopped', async (_case, script) => {
  const boss = fakeBoss();
  script(boss);
  await expect(migrateWith(boss)).rejects.toThrow();
  expect(boss.stop).toHaveBeenCalledOnce();
});

test('without an index build wait it uses the default, which does not wait when no build is queued', async () => {
  const db = await database({ runtimeRole: true });
  const result = await migrateJobQueues({
    connectionString: OWNER_URL,
    db,
    onError: vi.fn(),
    createBoss: () => fakeBoss(),
  });
  expect(result.created).toEqual([]);
});

test('without a pg-boss given it is the real one that starts: an unreachable database fails the step', async () => {
  const db = await database({ runtimeRole: true });
  const onError = vi.fn();
  await expect(migrateJobQueues({ connectionString: UNREACHABLE_DATABASE_URL, db, onError })).rejects.toThrow();
});
