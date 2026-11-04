// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sweepRepositoryCoalesceKey } from '../../domain/repository-jobs.ts';
import {
  failingAfterSend,
  fakeEnqueuer,
  jobCount,
  setJobStates,
  switchableEnqueuer,
} from '../../services/jobs-fixture/test-support.ts';
import {
  addedEntries,
  addToInstallation,
  addToRepository,
  allowlistWorld,
  createdAuditRows,
  entryOf,
  sweeps,
} from './allowlist-entry-fixture/test-support.ts';
import { documentWorld, errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { setEnabled } from './repository-document-fixture/test-support.ts';

// The sweeps that adding an allowlist entry sends (E14-S06), through the queue of the app: one `sweep-repository` job with the reason
// `allowlist_changed` for each enforcing repository the entry covers, in the transaction of the add, so a queue that fails leaves the
// list, the audit log and the queue as they were and a retry then succeeds. The queue is the fake of the webhook intake.

const ADA = { kind: 'user', login: 'ada-lovelace' } as const;

test('an entry for the installation sends one sweep for each repository of the tenant that enforces the CLA, and none for the other tenant', async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  await setEnabled(world, t1.plain.repositoryId, true);
  await setEnabled(world, t2.plain.repositoryId, true);
  const response = await addToInstallation(world, 'admin1', t1.installationId, ADA);
  const entry = entryOf(response);
  expect(await sweeps(world)).toEqual([
    {
      idempotencyKey: `sweep-repository:allowlist_changed:created:${entry.id}:${t1.plain.githubRepoId}`,
      dedupeKey: null,
      coalesceKey: sweepRepositoryCoalesceKey(t1.plain.githubRepoId),
      job: {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
        reason: 'allowlist_changed',
      },
    },
    {
      idempotencyKey: `sweep-repository:allowlist_changed:created:${entry.id}:${t1.scoped.githubRepoId}`,
      dedupeKey: null,
      coalesceKey: sweepRepositoryCoalesceKey(t1.scoped.githubRepoId),
      job: {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.scoped.githubRepoId,
        reason: 'allowlist_changed',
      },
    },
  ]);
});

test('a repository that is off, and one GitHub no longer lists, get no sweep', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await setEnabled(world, t1.plain.repositoryId, false);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const response = await addToInstallation(world, 'admin1', t1.installationId, ADA);
  expect(response.statusCode).toBe(201);
  expect(await jobCount(world.db)).toBe(0);
});

test('an entry for one repository sends one sweep for that repository, and none for another repository of the installation', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await setEnabled(world, t1.plain.repositoryId, true);
  const response = await addToRepository(world, 'admin1', t1.plain.repositoryId, ADA);
  expect(response.statusCode).toBe(201);
  const sent = await sweeps(world);
  expect(sent.map((job) => job.job)).toEqual([
    {
      type: 'sweep-repository',
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.plain.githubRepoId,
      reason: 'allowlist_changed',
    },
  ]);
});

test('an entry for a repository that is off sends no sweep', async () => {
  const world = await allowlistWorld();
  await setEnabled(world, world.t1.plain.repositoryId, false);
  const response = await addToRepository(world, 'admin1', world.t1.plain.repositoryId, ADA);
  expect([response.statusCode, await jobCount(world.db)]).toEqual([201, 0]);
});

test('rapid edits collapse: a second entry while the sweep of the repository still waits sends no second job', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ enabled: false })
    .where('installation_id', '=', t1.installationId)
    .execute();
  await setEnabled(world, t1.plain.repositoryId, true);
  const first = await addToRepository(world, 'admin1', t1.plain.repositoryId, ADA);
  const second = await addToRepository(world, 'admin1', t1.plain.repositoryId, {
    kind: 'bot',
    login: 'dependabot[bot]',
  });
  expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
  expect(await sweeps(world)).toHaveLength(1);
  expect(await addedEntries(world)).toHaveLength(2);
});

test('an entry after the sweep has started sends another: that run may have read the list before the change', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ enabled: false })
    .where('installation_id', '=', t1.installationId)
    .execute();
  await setEnabled(world, t1.plain.repositoryId, true);
  await addToRepository(world, 'admin1', t1.plain.repositoryId, ADA);
  await setJobStates(world.db, 'active');
  await addToRepository(world, 'admin1', t1.plain.repositoryId, { kind: 'bot', login: 'dependabot[bot]' });
  expect(await sweeps(world)).toHaveLength(2);
});

test('a queue that fails fails the call: 500, every tenant table as it was, no entry, no audit row, and the message does not leak', async () => {
  const world = await allowlistWorld(undefined, { enqueue: () => Promise.reject(new Error('queue down')) });
  const before = await tablesOf(world);
  const response = await addToInstallation(world, 'admin1', world.t1.installationId, ADA);
  expect(response.statusCode).toBe(500);
  expect(errorCodeOf(response)).toBe('internal_server_error');
  expect(response.body).not.toContain('queue down');
  expect(await tablesOf(world)).toEqual(before);
  expect(await addedEntries(world)).toEqual([]);
  expect(await createdAuditRows(world)).toEqual([]);
});

test('a retry after the queue came back succeeds: the entry is stored, with one audit row and the sweeps', async () => {
  const queue = switchableEnqueuer(fakeEnqueuer());
  const world = await allowlistWorld(undefined, queue);
  queue.failWith(new Error('connection lost'));
  const failed = await addToInstallation(world, 'admin1', world.t1.installationId, ADA);
  queue.failWith(undefined);
  const retried = await addToInstallation(world, 'admin1', world.t1.installationId, ADA);
  expect([failed.statusCode, retried.statusCode]).toEqual([500, 201]);
  expect(await addedEntries(world)).toHaveLength(1);
  expect(await createdAuditRows(world)).toHaveLength(1);
  expect(await sweeps(world)).toHaveLength(1);
});

test('a queue that fails after it took the job leaves no job behind, because the job commits with the entry or not at all', async () => {
  const world = await allowlistWorld(undefined, failingAfterSend(fakeEnqueuer(), new Error('connection lost')));
  const response = await addToInstallation(world, 'admin1', world.t1.installationId, ADA);
  expect(response.statusCode).toBe(500);
  expect(await jobCount(world.db)).toBe(0);
  expect(await addedEntries(world)).toEqual([]);
});

test('the app that has no queue yet fails an add that has a sweep to send, and stores nothing; one with nothing to sweep succeeds', async () => {
  const world = await documentWorld();
  const response = await addToInstallation(world, 'admin1', world.t1.installationId, { kind: 'org_members' });
  expect(response.statusCode).toBe(500);
  expect(await addedEntries(world)).toEqual([]);
  await world.db.updateTable('repositories').set({ enabled: false }).execute();
  const nothingToSweep = await addToInstallation(world, 'admin1', world.t1.installationId, { kind: 'org_members' });
  expect(nothingToSweep.statusCode).toBe(201);
});
