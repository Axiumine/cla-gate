// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  failingAfterSend,
  fakeEnqueuer,
  jobCount,
  switchableEnqueuer,
} from '../../services/jobs-fixture/test-support.ts';
import { documentWorld, parsed, tablesOf } from './document-fixture/test-support.ts';
import {
  disableAs,
  disabledAnswerOf,
  disabledAuditRows,
  disableWorld,
  finalisations,
} from './repository-disable-fixture/test-support.ts';
import { repositoryState, setEnabled } from './repository-document-fixture/test-support.ts';

// The job that turning enforcement off sends (E14-S04), through the queue of the app: one `finalise-repository` job in the transaction
// of the change, so a queue that fails leaves the repository on with no audit row and a retry then succeeds. The queue is the fake of
// the webhook intake, which writes into a test table on the transaction it is given.

test('a queue that fails fails the call: 500, the flag, the audit log and every tenant table as they were, and the message does not leak', async () => {
  const world = await disableWorld({ enqueue: () => Promise.reject(new Error('queue down')) });
  const before = await tablesOf(world);
  const response = await disableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(response.statusCode).toBe(500);
  expect(parsed(response, errorResponseSchema).error.code).toBe('internal_server_error');
  expect(response.body).not.toContain('queue down');
  expect(await tablesOf(world)).toEqual(before);
  expect((await repositoryState(world, world.t1.plain.repositoryId)).enabled).toBe(true);
  expect(await disabledAuditRows(world, world.t1.plain.githubRepoId)).toEqual([]);
});

test('a retry after the queue came back succeeds: the repository turns off, with one audit row and one job', async () => {
  const queue = switchableEnqueuer(fakeEnqueuer());
  const world = await disableWorld(queue);
  const { t1 } = world;
  queue.failWith(new Error('connection lost'));
  const failed = await disableAs(world, 'admin1', t1.plain.repositoryId);
  queue.failWith(undefined);
  const retried = await disableAs(world, 'admin1', t1.plain.repositoryId);
  expect([failed.statusCode, retried.statusCode]).toEqual([500, 200]);
  expect(disabledAnswerOf(retried)).toEqual({ enabled: false, changed: true });
  expect((await repositoryState(world, t1.plain.repositoryId)).enabled).toBe(false);
  expect(await disabledAuditRows(world, t1.plain.githubRepoId)).toHaveLength(1);
  expect(await finalisations(world)).toHaveLength(1);
});

test('a queue that fails after it took the job leaves no job behind, because the job commits with the change or not at all', async () => {
  const world = await disableWorld(failingAfterSend(fakeEnqueuer(), new Error('connection lost')));
  const response = await disableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(response.statusCode).toBe(500);
  expect(await jobCount(world.db)).toBe(0);
  expect((await repositoryState(world, world.t1.plain.repositoryId)).enabled).toBe(true);
});

test('the app that has no queue yet fails the call and leaves the repository on', async () => {
  const world = await documentWorld();
  await setEnabled(world, world.t1.plain.repositoryId, true);
  const response = await disableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(response.statusCode).toBe(500);
  expect((await repositoryState(world, world.t1.plain.repositoryId)).enabled).toBe(true);
});
