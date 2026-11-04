// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { sweepRepositoryCoalesceKey } from '../../domain/repository-jobs.ts';
import {
  createJobsTable,
  failingAfterSend,
  fakeEnqueuer,
  jobCount,
  sentJobs,
  setJobStates,
} from '../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { auditRows, documentWorld, parsed, tablesOf } from './document-fixture/test-support.ts';
import {
  answerOf,
  attachAs,
  pointAt,
  repositoryState,
  setEnabled,
  storeDocument,
} from './repository-document-fixture/test-support.ts';

// The sweep a change of the CLA of a repository sends (E14-S02), through the queue of the app: one `sweep-repository` job with the
// reason `cla_document_changed` when the repository enforces the CLA, in the transaction of the change, and none when it does not.
// The queue is the fake of the webhook intake, which writes into a test table on the transaction it is given.

/** A world whose queue is the fake, with the repository of tenant 1 that enforces the CLA (`org-1/scoped` is enabled) and its document published. */
async function enforcingWorld(enqueuer: JobEnqueuer = fakeEnqueuer()) {
  const world = await documentWorld({ enqueuer });
  await createJobsTable(world.db);
  const second = await storeDocument(world, { name: 'Second wide CLA', published: true });
  await pointAt(world, world.t1.scoped.repositoryId, world.t1.documentId);
  return { world, second };
}

test('a document that replaces the one an enforcing repository has sends one sweep with the reason, the ids of the job envelope and a key for the change', async () => {
  const { world, second } = await enforcingWorld();
  const { t1 } = world;
  const response = await attachAs(world, 'admin1', t1.scoped.repositoryId, second);
  expect([response.statusCode, answerOf(response).changed]).toEqual([200, true]);
  const stored = await repositoryState(world, t1.scoped.repositoryId);
  expect(await sentJobs(world.db)).toEqual([
    {
      idempotencyKey: `sweep-repository:cla_document_changed:${t1.scoped.githubRepoId}:${stored.updated_at.getTime()}`,
      dedupeKey: null,
      coalesceKey: sweepRepositoryCoalesceKey(t1.scoped.githubRepoId),
      job: {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.scoped.githubRepoId,
        reason: 'cla_document_changed',
      },
    },
  ]);
});

test('a first document attached to an enforcing repository sends the sweep too: the pull requests it already has are evaluated under it', async () => {
  const { world } = await enforcingWorld();
  await pointAt(world, world.t1.scoped.repositoryId, null);
  const response = await attachAs(world, 'admin1', world.t1.scoped.repositoryId, world.t1.documentId);
  expect(response.statusCode).toBe(200);
  expect((await sentJobs(world.db)).map((sent) => sent.job.type)).toEqual(['sweep-repository']);
});

test('a repository that does not enforce the CLA sends no sweep, and neither does a detach', async () => {
  const { world, second } = await enforcingWorld();
  const { t1 } = world;
  const attached = await attachAs(world, 'admin1', t1.plain.repositoryId, second);
  await setEnabled(world, t1.scoped.repositoryId, false);
  const detached = await attachAs(world, 'admin1', t1.scoped.repositoryId, null);
  expect([attached.statusCode, detached.statusCode]).toEqual([200, 200]);
  expect(await jobCount(world.db)).toBe(0);
});

test('a call that changes nothing sends no job: the same document again, and a detach of nothing', async () => {
  const { world } = await enforcingWorld();
  const { t1 } = world;
  const same = await attachAs(world, 'admin1', t1.scoped.repositoryId, t1.documentId);
  await pointAt(world, t1.scoped.repositoryId, null);
  const nothing = await attachAs(world, 'admin1', t1.scoped.repositoryId, null);
  expect([answerOf(same).changed, answerOf(nothing).changed]).toEqual([false, false]);
  expect(await jobCount(world.db)).toBe(0);
});

test('two changes while the first sweep waits send one job: that run reads the policy of the second when it starts, and both changes are audited', async () => {
  const { world, second } = await enforcingWorld();
  const { t1 } = world;
  await attachAs(world, 'admin1', t1.scoped.repositoryId, second);
  await attachAs(world, 'admin1', t1.scoped.repositoryId, t1.documentId);
  expect(await jobCount(world.db)).toBe(1);
  expect(await auditRows(world, 'repository.cla_document_attached')).toHaveLength(2);
});

test('a change after the first sweep has started sends another: that run may have read the policy before the change', async () => {
  const { world, second } = await enforcingWorld();
  const { t1 } = world;
  await attachAs(world, 'admin1', t1.scoped.repositoryId, second);
  await setJobStates(world.db, 'active');
  await attachAs(world, 'admin1', t1.scoped.repositoryId, t1.documentId);
  const keys = (await sentJobs(world.db)).map((sent) => sent.idempotencyKey);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(2);
});

test('a queue that fails fails the call: 500, the pointer, the audit log and every tenant table as they were, and the message does not leak', async () => {
  const { world, second } = await enforcingWorld({ enqueue: () => Promise.reject(new Error('queue down')) });
  const before = await tablesOf(world);
  const response = await attachAs(world, 'admin1', world.t1.scoped.repositoryId, second);
  expect(response.statusCode).toBe(500);
  expect(parsed(response, errorResponseSchema).error.code).toBe('internal_server_error');
  expect(response.body).not.toContain('queue down');
  expect(await tablesOf(world)).toEqual(before);
  expect(await auditRows(world, 'repository.cla_document_attached')).toEqual([]);
});

test('a queue that fails after it took the job leaves no job behind, because the job commits with the change or not at all', async () => {
  const inner = fakeEnqueuer();
  const { world, second } = await enforcingWorld(failingAfterSend(inner, new Error('connection lost')));
  const response = await attachAs(world, 'admin1', world.t1.scoped.repositoryId, second);
  expect(response.statusCode).toBe(500);
  expect(await jobCount(world.db)).toBe(0);
  expect((await repositoryState(world, world.t1.scoped.repositoryId)).cla_document_id).toBe(world.t1.documentId);
});

test('the app that has no queue yet fails the change of an enforcing repository and makes the change of one that does not enforce', async () => {
  const world = await documentWorld();
  const second = await storeDocument(world, { name: 'Second wide CLA', published: true });
  const refused = await attachAs(world, 'admin1', world.t1.scoped.repositoryId, second);
  const made = await attachAs(world, 'admin1', world.t1.plain.repositoryId, second);
  expect([refused.statusCode, made.statusCode]).toEqual([500, 200]);
  expect((await repositoryState(world, world.t1.scoped.repositoryId)).cla_document_id).toBeNull();
});
