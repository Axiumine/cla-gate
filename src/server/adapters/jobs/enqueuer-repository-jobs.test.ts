// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import {
  enqueueFinaliseCheck,
  enqueueFinaliseRepository,
  enqueueSweepRepository,
  type RepositoryJobTarget,
} from '../../services/repository-job-enqueue.ts';
import type { Database } from '../db/schema.ts';
import { migratedTestDatabase } from '../db/test-support.ts';
import { PgBossEnqueuer } from './enqueuer.ts';
import { jobIdFor } from './job-id.ts';
import { QUEUES } from './queues.ts';
import { fakeBoss } from './test-support.ts';

// What the adapter asks of pg-boss for the repository-level jobs (E07-S09), with a pg-boss that is only a script: the queue each
// goes to, its key, and the window. That a window drops the second send for one repository and not for another, and that two
// finalisations of a pull request never overlap, is shown on a real queue in repository-jobs-real.test.ts.

const TARGET: RepositoryJobTarget = {
  githubInstallationId: parseGithubId(5000),
  githubRepoId: parseGithubId(9000),
  idempotencyKey: 'change-1',
};
const SOME_CONNECTION: unknown = expect.anything();

async function inTransaction<T>(work: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
  const { db } = await migratedTestDatabase();
  return db.transaction().execute(work);
}

test('the three queues of the repository-level jobs are named like their job types', () => {
  for (const name of ['sweep-repository', 'finalise-repository', 'finalise-check']) {
    expect(QUEUES).toContain(name);
  }
});

test('a sweep-repository goes to its own queue, keyed per repository for the coalesce check, with no window, and is not serialised', async () => {
  const boss = fakeBoss();
  const enqueuer = new PgBossEnqueuer(boss);
  const outcome = await inTransaction((tx) =>
    enqueueSweepRepository(tx, enqueuer, { ...TARGET, reason: 'override_changed' }),
  );
  expect(outcome).toBe('queued');
  expect(boss.send).toHaveBeenCalledExactlyOnceWith(
    'sweep-repository',
    {
      type: 'sweep-repository',
      githubInstallationId: TARGET.githubInstallationId,
      githubRepoId: TARGET.githubRepoId,
      reason: 'override_changed',
    },
    { id: jobIdFor('change-1'), db: SOME_CONNECTION, singletonKey: 'sweep-repository:9000' },
  );
});

test('a second sweep-repository for the repository while the first waits is deduplicated by the adapter without a send, and one for another repository is sent', async () => {
  const boss = fakeBoss();
  boss.send.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');
  // The lookups, in order: the job under the id and the waiting job of the key, for each send.
  boss.findJobs
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: jobIdFor('a'), state: 'created' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  const enqueuer = new PgBossEnqueuer(boss);
  const send = (githubRepoId: number, idempotencyKey: string) =>
    inTransaction((tx) =>
      enqueueSweepRepository(tx, enqueuer, {
        ...TARGET,
        githubRepoId: parseGithubId(githubRepoId),
        idempotencyKey,
        reason: 'allowlist_changed',
      }),
    );
  expect(await send(9000, 'a')).toBe('queued');
  expect(await send(9000, 'b')).toBe('deduplicated');
  expect(await send(9001, 'c')).toBe('queued');
  expect(boss.send.mock.calls.map(([, , options]) => options.singletonKey)).toEqual([
    'sweep-repository:9000',
    'sweep-repository:9001',
  ]);
  expect(boss.findJobs.mock.calls.filter(([, options]) => options.queued === true)).toEqual([
    ['sweep-repository', { key: 'sweep-repository:9000', queued: true, limit: 1, db: SOME_CONNECTION }],
    ['sweep-repository', { key: 'sweep-repository:9000', queued: true, limit: 1, db: SOME_CONNECTION }],
    ['sweep-repository', { key: 'sweep-repository:9001', queued: true, limit: 1, db: SOME_CONNECTION }],
  ]);
});

test('a finalise-check is serialised under the key of the evaluate-pr of its pull request, with no window', async () => {
  const boss = fakeBoss();
  await inTransaction((tx) =>
    enqueueFinaliseCheck(tx, new PgBossEnqueuer(boss), { ...TARGET, prNumber: 42, idempotencyKey: 'finalise-42' }),
  );
  expect(boss.send).toHaveBeenCalledExactlyOnceWith(
    'finalise-check',
    {
      type: 'finalise-check',
      githubInstallationId: TARGET.githubInstallationId,
      githubRepoId: TARGET.githubRepoId,
      prNumber: 42,
    },
    { id: jobIdFor('finalise-42'), db: SOME_CONNECTION, singletonKey: '9000:42' },
  );
});

test('a finalise-repository is serialised per repository, with no window', async () => {
  const boss = fakeBoss();
  await inTransaction((tx) => enqueueFinaliseRepository(tx, new PgBossEnqueuer(boss), TARGET));
  expect(boss.send).toHaveBeenCalledExactlyOnceWith(
    'finalise-repository',
    {
      type: 'finalise-repository',
      githubInstallationId: TARGET.githubInstallationId,
      githubRepoId: TARGET.githubRepoId,
    },
    { id: jobIdFor('change-1'), db: SOME_CONNECTION, singletonKey: '9000' },
  );
});

test('an evaluate-pr of a policy change is throttled under the key of its pull request, the one every other trigger shares', async () => {
  const boss = fakeBoss();
  const job = {
    type: 'evaluate-pr',
    githubInstallationId: TARGET.githubInstallationId,
    githubRepoId: TARGET.githubRepoId,
    prNumber: 42,
    trigger: 'policy_change',
  } as const;
  await inTransaction((tx) =>
    new PgBossEnqueuer(boss).enqueue(tx, job, {
      idempotencyKey: 'sweep-repository:job-1:9000:42',
      dedupeKey: 'policy_change:9000:42',
      dedupeWindowSeconds: 60,
    }),
  );
  expect(boss.send).toHaveBeenCalledExactlyOnceWith('evaluate-pr', job, {
    id: jobIdFor('sweep-repository:job-1:9000:42'),
    db: SOME_CONNECTION,
    singletonKey: '9000:42',
    singletonSeconds: 60,
  });
});
