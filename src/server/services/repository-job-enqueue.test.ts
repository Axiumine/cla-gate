// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { jobEnvelopeSchema } from '../domain/job-envelope.ts';
import { SWEEP_REPOSITORY_REASONS } from '../domain/repository-jobs.ts';
import { createJobsTable, fakeEnqueuer, sentJobs, setJobStates } from './jobs-fixture/test-support.ts';
import {
  enqueueFinaliseCheck,
  enqueueFinaliseRepository,
  enqueueSweepRepository,
  type RepositoryJobTarget,
} from './repository-job-enqueue.ts';
import { FakeClock } from './test-support.ts';

// How a change of policy asks for work on a repository (E07-S09): the keys and the windows are fixed here, not by the caller.

const INSTALLATION = parseGithubId(5000);
const REPOSITORY = parseGithubId(9000);
const TARGET: RepositoryJobTarget = {
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  idempotencyKey: 'change-1',
};

async function world() {
  const { db } = await migratedTestDatabase();
  await createJobsTable(db);
  const clock = new FakeClock('2026-11-02T10:00:00Z');
  const enqueuer = fakeEnqueuer(clock);
  return {
    db,
    clock,
    enqueuer,
    send: <T>(work: (tx: Parameters<typeof enqueueSweepRepository>[0]) => Promise<T>) => db.transaction().execute(work),
  };
}

test('a sweep-repository is sent as the envelope of the story, under the coalesce key of its repository', async () => {
  const w = await world();
  const outcome = await w.send((tx) =>
    enqueueSweepRepository(tx, w.enqueuer, { ...TARGET, reason: 'cla_version_published' }),
  );
  expect(outcome).toBe('queued');
  expect(w.enqueuer.calls).toEqual([
    {
      job: {
        type: 'sweep-repository',
        githubInstallationId: INSTALLATION,
        githubRepoId: REPOSITORY,
        reason: 'cla_version_published',
      },
      options: { idempotencyKey: 'change-1', coalesceKey: 'sweep-repository:9000' },
    },
  ]);
  expect((await sentJobs(w.db)).map(({ job }) => jobEnvelopeSchema.parse(job))).toHaveLength(1);
});

test.each(SWEEP_REPOSITORY_REASONS)(
  'a sweep-repository with the reason %s is a valid job of the envelope',
  async (reason) => {
    const w = await world();
    await w.send((tx) => enqueueSweepRepository(tx, w.enqueuer, { ...TARGET, reason }));
    expect((await sentJobs(w.db)).map(({ job }) => job)).toEqual([
      { type: 'sweep-repository', githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY, reason },
    ]);
  },
);

test('rapid edits of one repository collapse into the job that waits, whatever their reasons, and a run that started does not absorb the next edit', async () => {
  const w = await world();
  const send = (githubRepoId: number, idempotencyKey: string, reason: (typeof SWEEP_REPOSITORY_REASONS)[number]) =>
    w.send((tx) =>
      enqueueSweepRepository(tx, w.enqueuer, {
        ...TARGET,
        githubRepoId: parseGithubId(githubRepoId),
        idempotencyKey,
        reason,
      }),
    );
  expect(await send(9000, 'a', 'allowlist_changed')).toBe('queued');
  expect(await send(9000, 'b', 'override_changed')).toBe('deduplicated');
  expect(await send(9001, 'c', 'override_changed')).toBe('queued');
  await setJobStates(w.db, 'active');
  expect(await send(9000, 'd', 'override_changed')).toBe('queued');
  expect(await send(9000, 'e', 'override_changed')).toBe('deduplicated');
  expect((await sentJobs(w.db)).map(({ idempotencyKey }) => idempotencyKey)).toEqual(['a', 'c', 'd']);
});

test('a caller that is retried sends the same idempotency key and finds its own job', async () => {
  const w = await world();
  const send = () =>
    w.send((tx) => enqueueSweepRepository(tx, w.enqueuer, { ...TARGET, reason: 'repository_enabled' }));
  expect(await send()).toBe('queued');
  w.clock.advance(120_000);
  expect(await send()).toBe('already_queued');
});

test('a finalise-repository is sent as the envelope of the story, under an idempotency key and no window: a disable after an enable is finalised too', async () => {
  const w = await world();
  const send = (idempotencyKey: string) =>
    w.send((tx) => enqueueFinaliseRepository(tx, w.enqueuer, { ...TARGET, idempotencyKey }));
  expect(await send('disable-1')).toBe('queued');
  expect(await send('disable-2')).toBe('queued');
  expect(await send('disable-2')).toBe('already_queued');
  expect(w.enqueuer.calls[0]).toEqual({
    job: { type: 'finalise-repository', githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY },
    options: { idempotencyKey: 'disable-1' },
  });
});

test('a finalise-check is sent as the envelope of the story, with the pull request number, under an idempotency key and no window', async () => {
  const w = await world();
  const send = (prNumber: number) =>
    w.send((tx) =>
      enqueueFinaliseCheck(tx, w.enqueuer, { ...TARGET, prNumber, idempotencyKey: `finalise:${prNumber}` }),
    );
  expect(await send(7)).toBe('queued');
  expect(await send(8)).toBe('queued');
  expect(w.enqueuer.calls[0]).toEqual({
    job: { type: 'finalise-check', githubInstallationId: INSTALLATION, githubRepoId: REPOSITORY, prNumber: 7 },
    options: { idempotencyKey: 'finalise:7' },
  });
  expect((await sentJobs(w.db)).map(({ job }) => job.type)).toEqual(['finalise-check', 'finalise-check']);
});

test('a transaction that rolls back takes the job with it', async () => {
  const w = await world();
  const rollback = new Error('rolled back on purpose');
  await expect(
    w.send(async (tx) => {
      await enqueueSweepRepository(tx, w.enqueuer, { ...TARGET, reason: 'repository_enabled' });
      await enqueueFinaliseRepository(tx, w.enqueuer, { ...TARGET, idempotencyKey: 'finalise-1' });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await sentJobs(w.db)).toEqual([]);
});
