// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  failingAfterSend,
  fakeEnqueuer,
  jobCount,
  setJobStates,
  switchableEnqueuer,
} from '../../services/jobs-fixture/test-support.ts';
import { documentWorld, parsed, tablesOf } from './document-fixture/test-support.ts';
import { pointAt, repositoryState } from './repository-document-fixture/test-support.ts';
import {
  enableAs,
  enabledAnswerOf,
  enabledAuditRows,
  enableWorld,
  sweeps,
} from './repository-enable-fixture/test-support.ts';

// The sweep that turning enforcement on sends (E14-S03), through the queue of the app: one `sweep-repository` job in the transaction of
// the change, so a queue that fails leaves the repository off with no audit row and a retry then succeeds. The queue is the fake of the
// webhook intake, which writes into a test table on the transaction it is given.

test('a queue that fails fails the call: 500, the flag, the audit log and every tenant table as they were, and the message does not leak', async () => {
  const world = await enableWorld({ enqueue: () => Promise.reject(new Error('queue down')) });
  const before = await tablesOf(world);
  const response = await enableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(response.statusCode).toBe(500);
  expect(parsed(response, errorResponseSchema).error.code).toBe('internal_server_error');
  expect(response.body).not.toContain('queue down');
  expect(await tablesOf(world)).toEqual(before);
  expect((await repositoryState(world, world.t1.plain.repositoryId)).enabled).toBe(false);
  expect(await enabledAuditRows(world, world.t1.plain.githubRepoId)).toEqual([]);
});

test('a retry after the queue came back succeeds: the repository turns on, with one audit row and one job', async () => {
  const queue = switchableEnqueuer(fakeEnqueuer());
  const world = await enableWorld(queue);
  const { t1 } = world;
  queue.failWith(new Error('connection lost'));
  const failed = await enableAs(world, 'admin1', t1.plain.repositoryId);
  queue.failWith(undefined);
  const retried = await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect([failed.statusCode, retried.statusCode]).toEqual([500, 200]);
  expect(enabledAnswerOf(retried)).toEqual({ enabled: true, changed: true });
  expect((await repositoryState(world, t1.plain.repositoryId)).enabled).toBe(true);
  expect(await enabledAuditRows(world, t1.plain.githubRepoId)).toHaveLength(1);
  expect(await sweeps(world)).toHaveLength(1);
});

test('a queue that fails after it took the job leaves no job behind, because the job commits with the change or not at all', async () => {
  const world = await enableWorld(failingAfterSend(fakeEnqueuer(), new Error('connection lost')));
  const response = await enableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(response.statusCode).toBe(500);
  expect(await jobCount(world.db)).toBe(0);
  expect((await repositoryState(world, world.t1.plain.repositoryId)).enabled).toBe(false);
});

test('the app that has no queue yet fails the call and leaves the repository off', async () => {
  const world = await documentWorld();
  await pointAt(world, world.t1.plain.repositoryId, world.t1.documentId);
  const response = await enableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(response.statusCode).toBe(500);
  expect((await repositoryState(world, world.t1.plain.repositoryId)).enabled).toBe(false);
});

test('an enable while a sweep of the repository waits sends no second job: that run reads the policy when it starts', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.plain.repositoryId).execute();
  const again = await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect(enabledAnswerOf(again).changed).toBe(true);
  expect(await jobCount(world.db)).toBe(1);
  expect(await enabledAuditRows(world, t1.plain.githubRepoId)).toHaveLength(2);
});

test('an enable after the first sweep has started sends another: that run may have read the policy before the change', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await setJobStates(world.db, 'active');
  await world.db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.plain.repositoryId).execute();
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect(await sweeps(world)).toHaveLength(2);
});
