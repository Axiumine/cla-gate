// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, onTestFinished, test, vi } from 'vitest';
import { UNREACHABLE_DATABASE_URL } from '../../test-support.ts';
import { openPgliteDatabase } from '../db/pglite.ts';
import { emptyTestDatabase, ensureRuntimeRole } from '../db/test-support.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { QueuePolicyError } from './queue-policy.ts';
import {
  DEFINITIONS_IN_CREATION_ORDER,
  QUEUE_DEFINITIONS,
  QUEUES,
  queueSettings,
  SCHEDULER_QUEUE,
  schedulerQueueSettings,
} from './queues.ts';
import { EXPECTED_BOUNDS, fakeBoss } from './test-support.ts';

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

test('it starts pg-boss with the options of the owner and creates every queue that is missing, the dead-letter queue first', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([]);
  const { result, createBoss } = await migrateWith(boss);
  expect(createBoss).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ connectionString: OWNER_URL, migrate: true, createSchema: true, supervise: false }),
  );
  const created = ['job-dead-letter', ...QUEUES.slice(0, -1), SCHEDULER_QUEUE];
  expect(boss.createQueue.mock.calls.map(([name]) => name)).toEqual(created);
  expect(result.created).toEqual(created);
});

test('every queue is created with its policy and the bounds of E07-S05: 5 retries, 30 s doubling, 300 s expiry, retention windows, job-dead-letter', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([]);
  await migrateWith(boss);
  expect(boss.createQueue.mock.calls).toEqual([
    ...DEFINITIONS_IN_CREATION_ORDER.map((definition) => [definition.name, queueSettings(definition)]),
    [SCHEDULER_QUEUE, schedulerQueueSettings()],
  ]);
  expect(boss.createQueue).toHaveBeenCalledWith('evaluate-pr', {
    policy: 'singleton',
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    retentionSeconds: 1_209_600,
    deleteAfterSeconds: 604_800,
    deadLetter: 'job-dead-letter',
  });
});

test('the queue pg-boss files scheduled occurrences in is created last, with the bounds of the others and no dead-letter queue, so the runtime role creates none (E07-S08)', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([]);
  await migrateWith(boss);
  const [name, settings] = boss.createQueue.mock.calls.at(-1) ?? [];
  expect(name).toBe('__pgboss__send-it');
  expect(settings).toEqual({
    policy: 'standard',
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    retentionSeconds: 1_209_600,
    deleteAfterSeconds: 604_800,
  });
  expect(settings).not.toHaveProperty('deadLetter');
});

test('the scheduler queue is asked for with the others in one read, and one that exists is left alone, even with other bounds', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([
    ...QUEUE_DEFINITIONS.map((definition) => ({ name: definition.name, ...queueSettings(definition) })),
    { name: SCHEDULER_QUEUE, policy: 'standard', retryLimit: 2, retryDelay: 0 },
  ]);
  const { result } = await migrateWith(boss);
  expect(boss.getQueues).toHaveBeenCalledExactlyOnceWith([...QUEUES, SCHEDULER_QUEUE]);
  expect(boss.createQueue).not.toHaveBeenCalled();
  expect(boss.updateQueue).not.toHaveBeenCalled();
  expect(result).toMatchObject({ created: [], updated: [] });
});

test('the dead-letter queue is created with the same bounds and no dead-letter queue of its own', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([]);
  await migrateWith(boss);
  const [name, settings] = boss.createQueue.mock.calls[0] ?? [];
  expect(name).toBe('job-dead-letter');
  expect(settings).toEqual({
    policy: 'standard',
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    retentionSeconds: 1_209_600,
    deleteAfterSeconds: 604_800,
  });
  expect(settings).not.toHaveProperty('deadLetter');
});

test('a queue that exists with another policy fails the step before anything is created, and pg-boss is stopped', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce([{ name: 'evaluate-pr', policy: 'standard' }]);
  const error = await migrateWith(boss).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(QueuePolicyError);
  expect(error).toMatchObject({ mismatches: [{ queue: 'evaluate-pr', found: 'standard', expected: 'singleton' }] });
  expect(boss.createQueue).not.toHaveBeenCalled();
  expect(boss.stop).toHaveBeenCalledOnce();
});

test('it creates only the queues that do not exist: a run on a migrated database creates none', async () => {
  const boss = fakeBoss();
  const { result } = await migrateWith(boss);
  expect(boss.createQueue).not.toHaveBeenCalled();
  expect(result.created).toEqual([]);
});

test('with some queues present it creates the others and leaves the ones in line alone', async () => {
  const boss = fakeBoss();
  const present = QUEUE_DEFINITIONS.filter(({ name }) => name === 'evaluate-pr' || name === 'sweep');
  boss.getQueues.mockResolvedValueOnce(
    present.map((definition) => ({ name: definition.name, ...queueSettings(definition) })),
  );
  const { result } = await migrateWith(boss);
  expect(result.created).not.toContain('sweep');
  expect(result.created).toHaveLength(QUEUES.length - 2 + 1);
  expect(result.updated).toEqual([]);
  expect(boss.createQueue).not.toHaveBeenCalledWith('evaluate-pr', expect.anything());
  expect(boss.updateQueue).not.toHaveBeenCalled();
});

test('a database of a build before E07-S09 gets the three queues of the repository-level jobs, with their policies and bounds, and nothing else is touched', async () => {
  const boss = fakeBoss();
  const later = ['sweep-repository', 'finalise-repository', 'finalise-check'];
  boss.getQueues.mockResolvedValueOnce([
    ...QUEUE_DEFINITIONS.filter(({ name }) => !later.includes(name)).map((definition) => ({
      name: definition.name,
      ...queueSettings(definition),
    })),
    { name: SCHEDULER_QUEUE, ...schedulerQueueSettings() },
  ]);
  const { result } = await migrateWith(boss);
  expect(result.created).toEqual(later);
  expect(result.updated).toEqual([]);
  expect(boss.createQueue.mock.calls).toEqual([
    ['sweep-repository', { policy: 'standard', ...EXPECTED_BOUNDS, deadLetter: 'job-dead-letter' }],
    ['finalise-repository', { policy: 'singleton', ...EXPECTED_BOUNDS, deadLetter: 'job-dead-letter' }],
    ['finalise-check', { policy: 'singleton', ...EXPECTED_BOUNDS, deadLetter: 'job-dead-letter' }],
  ]);
  expect(boss.updateQueue).not.toHaveBeenCalled();
});

test('a queue an older build created with default bounds is brought in line, once, with the bounds and the dead-letter queue', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce(
    QUEUE_DEFINITIONS.map(({ name, policy }) => ({ name, policy, expireInSeconds: 300, retryLimit: 2, retryDelay: 0 })),
  );
  const { result } = await migrateWith(boss);
  expect(boss.createQueue.mock.calls.map(([name]) => name)).toEqual([SCHEDULER_QUEUE]);
  expect(result.created).toEqual([SCHEDULER_QUEUE]);
  expect(result.updated).toEqual(['job-dead-letter', ...QUEUES.slice(0, -1)]);
  expect(boss.updateQueue.mock.calls[0]).toEqual([
    'job-dead-letter',
    {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
      retentionSeconds: 1_209_600,
      deleteAfterSeconds: 604_800,
      deadLetter: null,
    },
  ]);
  expect(boss.updateQueue.mock.calls[1]).toEqual([
    'evaluate-pr',
    expect.objectContaining({ retryLimit: 5, deadLetter: 'job-dead-letter' }),
  ]);
});

test('a queue that differs only in its dead-letter queue is updated too, and the policy is never part of an update', async () => {
  const boss = fakeBoss();
  const sweep = QUEUE_DEFINITIONS.find(({ name }) => name === 'sweep');
  boss.getQueues.mockResolvedValueOnce(
    QUEUE_DEFINITIONS.map((definition) => ({
      name: definition.name,
      ...queueSettings(definition),
      ...(definition === sweep ? { deadLetter: 'somewhere-else' } : {}),
    })),
  );
  const { result } = await migrateWith(boss);
  expect(result.updated).toEqual(['sweep']);
  expect(boss.updateQueue).toHaveBeenCalledExactlyOnceWith(
    'sweep',
    expect.objectContaining({ deadLetter: 'job-dead-letter' }),
  );
  expect(boss.updateQueue.mock.calls[0]?.[1]).not.toHaveProperty('policy');
});

test('the dead-letter queue with a dead-letter queue of its own has it cleared, so there is no loop', async () => {
  const boss = fakeBoss();
  boss.getQueues.mockResolvedValueOnce(
    QUEUE_DEFINITIONS.map((definition) => ({
      name: definition.name,
      ...queueSettings(definition),
      ...(definition.name === 'job-dead-letter' ? { deadLetter: 'sweep' } : {}),
    })),
  );
  const { result } = await migrateWith(boss);
  expect(result.updated).toEqual(['job-dead-letter']);
  expect(boss.updateQueue).toHaveBeenCalledExactlyOnceWith(
    'job-dead-letter',
    expect.objectContaining({ deadLetter: null }),
  );
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
