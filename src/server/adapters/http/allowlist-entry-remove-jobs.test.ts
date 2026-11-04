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
import { sweeps } from './allowlist-entry-fixture/test-support.ts';
import {
  allowlistWorld,
  deletedAuditRows,
  entryIdOfAccount,
  entryIdsOf,
  removeEntryAs,
} from './allowlist-list-fixture/test-support.ts';
import { documentWorld, errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { setEnabled } from './repository-document-fixture/test-support.ts';

// The sweeps that removing an allowlist entry sends (E14-S07), through the queue of the app: taking an exemption away can turn a green
// check red, so each enforcing repository the entry covered gets one `sweep-repository` job with the reason `allowlist_changed`, in
// the transaction of the removal, so a queue that fails leaves the list, the audit log and the queue as they were and a retry then
// succeeds. The queue is the fake of the webhook intake. The adds are in allowlist-entry-jobs.test.ts.

type World = Awaited<ReturnType<typeof allowlistWorld>>;

/** Turns every repository of tenant 1 off but the plain one, which is on: the one repository a sweep can be sent for. */
async function onlyPlainEnforces(world: World): Promise<void> {
  await world.db
    .updateTable('repositories')
    .set({ enabled: false })
    .where('installation_id', '=', world.t1.installationId)
    .execute();
  await setEnabled(world, world.t1.plain.repositoryId, true);
}

test('removing an entry of the installation sends one sweep for each repository of the tenant that enforces the CLA, and none for the other tenant', async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  await setEnabled(world, t1.plain.repositoryId, true);
  await setEnabled(world, t2.plain.repositoryId, true);
  const response = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  expect(response.statusCode).toBe(204);
  const sent = await sweeps(world);
  expect(sent.map((job) => [job.idempotencyKey, job.coalesceKey, job.job])).toEqual(
    [t1.plain, t1.scoped].map((repository) => [
      `sweep-repository:allowlist_changed:deleted:${t1.entryId}:${repository.githubRepoId}`,
      sweepRepositoryCoalesceKey(repository.githubRepoId),
      {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: repository.githubRepoId,
        reason: 'allowlist_changed',
      },
    ]),
  );
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
  const response = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  expect([response.statusCode, await jobCount(world.db)]).toEqual([204, 0]);
});

test('removing an entry of one repository sends one sweep for that repository, and none for another repository of the installation', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  const entry = await entryIdOfAccount(world, t1.installationId, 101);
  await setEnabled(world, t1.plain.repositoryId, true);
  const response = await removeEntryAs(world, 'admin1', t1.installationId, entry);
  expect(response.statusCode).toBe(204);
  expect((await sweeps(world)).map((job) => [job.idempotencyKey, job.job])).toEqual([
    [
      `sweep-repository:allowlist_changed:deleted:${entry}:${t1.plain.githubRepoId}`,
      {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
        reason: 'allowlist_changed',
      },
    ],
  ]);
});

test('removing an entry of a repository that is off sends no sweep', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await setEnabled(world, t1.plain.repositoryId, false);
  const response = await removeEntryAs(
    world,
    'admin1',
    t1.installationId,
    await entryIdOfAccount(world, t1.installationId, 101),
  );
  expect([response.statusCode, await jobCount(world.db)]).toEqual([204, 0]);
});

test('rapid removals collapse: a second entry removed while the sweep of the repository still waits sends no second job', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await onlyPlainEnforces(world);
  const first = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  const second = await removeEntryAs(
    world,
    'admin1',
    t1.installationId,
    await entryIdOfAccount(world, t1.installationId, 101),
  );
  expect([first.statusCode, second.statusCode]).toEqual([204, 204]);
  expect(await sweeps(world)).toHaveLength(1);
  expect(await entryIdsOf(world, t1.installationId)).toEqual([]);
});

test('a removal after the sweep has started sends another: that run may have read the list before the change', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await onlyPlainEnforces(world);
  await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  await setJobStates(world.db, 'active');
  await removeEntryAs(world, 'admin1', t1.installationId, await entryIdOfAccount(world, t1.installationId, 101));
  expect(await sweeps(world)).toHaveLength(2);
});

test('a queue that fails fails the call: 500, every tenant table as it was, the entry still there, no audit row, and the message does not leak', async () => {
  const world = await allowlistWorld(undefined, { enqueue: () => Promise.reject(new Error('queue down')) });
  const { t1 } = world;
  const before = await tablesOf(world);
  const response = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  expect(response.statusCode).toBe(500);
  expect(errorCodeOf(response)).toBe('internal_server_error');
  expect(response.body).not.toContain('queue down');
  expect(await tablesOf(world)).toEqual(before);
  expect(await entryIdsOf(world, t1.installationId)).toContain(t1.entryId);
  expect(await deletedAuditRows(world)).toEqual([]);
});

test('a retry after the queue came back succeeds: the entry is gone, with one audit row and the sweeps', async () => {
  const queue = switchableEnqueuer(fakeEnqueuer());
  const world = await allowlistWorld(undefined, queue);
  const { t1 } = world;
  await onlyPlainEnforces(world);
  queue.failWith(new Error('connection lost'));
  const failed = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  queue.failWith(undefined);
  const retried = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  expect([failed.statusCode, retried.statusCode]).toEqual([500, 204]);
  expect(await entryIdsOf(world, t1.installationId)).not.toContain(t1.entryId);
  expect(await deletedAuditRows(world)).toHaveLength(1);
  expect(await sweeps(world)).toHaveLength(1);
});

test('a queue that fails after it took the job leaves no job behind, because the job commits with the removal or not at all', async () => {
  const world = await allowlistWorld(undefined, failingAfterSend(fakeEnqueuer(), new Error('connection lost')));
  const { t1 } = world;
  const response = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  expect(response.statusCode).toBe(500);
  expect(await jobCount(world.db)).toBe(0);
  expect(await entryIdsOf(world, t1.installationId)).toContain(t1.entryId);
});

test('the app that has no queue yet fails a removal that has a sweep to send, and keeps the entry; one with nothing to sweep succeeds', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  const response = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  expect(response.statusCode).toBe(500);
  expect(await entryIdsOf(world, t1.installationId)).toContain(t1.entryId);
  await world.db.updateTable('repositories').set({ enabled: false }).execute();
  const nothingToSweep = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  expect(nothingToSweep.statusCode).toBe(204);
});
