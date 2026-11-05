// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sweepRepositoryCoalesceKey } from '../../domain/repository-jobs.ts';
import {
  createJobsTable,
  failingAfterSend,
  fakeEnqueuer,
  jobCount,
  sentJobs,
} from '../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import {
  type CorporateWorld,
  choiceUrl,
  corporateWorld,
  storeCorporateDocument,
} from './corporate-fixture/test-support.ts';

// The sweep a change of the corporate CLA of a repository sends (E21-S02, E21-S05): the evaluation reads the corporate document, so the
// open pull requests of an enforcing repository are evaluated again, in the transaction of the change, as after a change of the CLA of
// E14-S02. The queue is the fake of the webhook intake, which writes into a test table on the transaction it is given.

/** A world whose queue is the fake; the plain repository of tenant 1 enforces the CLA and has the corporate document `c1`. */
async function enforcingWorld(enqueuer: JobEnqueuer = fakeEnqueuer()) {
  const world = await corporateWorld({}, { enqueuer });
  await createJobsTable(world.db);
  return world;
}

/** Sends `payload` as the org admin of tenant 1 to the choice of the corporate CLA of the plain repository of tenant 1. */
function choose(world: CorporateWorld, payload: object) {
  return world.ask('admin1', {
    method: 'PUT',
    url: choiceUrl(world.t1.installationId, world.t1.plain.repositoryId),
    payload,
  });
}

async function updatedAt(world: CorporateWorld): Promise<Date> {
  const row = await world.db
    .selectFrom('repositories')
    .select('updated_at')
    .where('id', '=', world.t1.plain.repositoryId)
    .executeTakeFirstOrThrow();
  return row.updated_at;
}

test('another corporate document for an enforcing repository sends one sweep with the ids of the job envelope, the reason and a key for the change', async () => {
  const world = await enforcingWorld();
  const other = await storeCorporateDocument(world, { name: 'Corporate CLA 2' });
  expect((await choose(world, { documentId: other })).statusCode).toBe(200);
  const { t1 } = world;
  expect(await sentJobs(world.db)).toEqual([
    {
      idempotencyKey: `sweep-repository:corporate_document_set:${t1.plain.githubRepoId}:${(await updatedAt(world)).getTime()}`,
      dedupeKey: null,
      coalesceKey: sweepRepositoryCoalesceKey(t1.plain.githubRepoId),
      job: {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
        reason: 'cla_document_changed',
      },
    },
  ]);
});

test('removing the choice sends the sweep too: the employees the corporate agreements covered are covered no longer', async () => {
  const world = await enforcingWorld();
  expect((await choose(world, { documentId: null })).statusCode).toBe(200);
  expect((await sentJobs(world.db)).map((sent) => sent.job.type)).toEqual(['sweep-repository']);
});

test('a repository that does not enforce the CLA sends no sweep, and neither does a call that changes nothing', async () => {
  const world = await enforcingWorld();
  const same = await choose(world, { documentId: world.c1.document.documentId });
  await world.db
    .updateTable('repositories')
    .set({ enabled: false })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  const removed = await choose(world, { documentId: null });
  expect([same.statusCode, removed.statusCode]).toEqual([200, 200]);
  expect(await jobCount(world.db)).toBe(0);
});

test('a queue that fails fails the call: 500, the pointer and the audit log as they were', async () => {
  const world = await enforcingWorld({ enqueue: () => Promise.reject(new Error('queue down')) });
  const response = await choose(world, { documentId: null });
  expect(response.statusCode).toBe(500);
  expect(response.body).not.toContain('queue down');
  const row = await world.db
    .selectFrom('repositories')
    .select('corporate_document_id')
    .where('id', '=', world.t1.plain.repositoryId)
    .executeTakeFirstOrThrow();
  expect(row.corporate_document_id).toBe(world.c1.document.documentId);
  expect(
    await world.db
      .selectFrom('audit_log')
      .select('id')
      .where('action', '=', 'repository.corporate_document_set')
      .execute(),
  ).toEqual([]);
});

test('a queue that fails after it took the job leaves no job behind: the job commits with the change or not at all', async () => {
  const world = await enforcingWorld(failingAfterSend(fakeEnqueuer(), new Error('connection lost')));
  expect((await choose(world, { documentId: null })).statusCode).toBe(500);
  expect(await jobCount(world.db)).toBe(0);
});
