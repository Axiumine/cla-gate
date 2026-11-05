// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  addSignatures,
  invalidationAuditRows,
  majorOneOf,
  signatureStates,
} from '../../services/invalidation-fixture/test-support.ts';
import { fakeEnqueuer, sentJobs, switchableEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { coveredBy, sentAs, storePr } from '../../services/revocation-fixture/test-support.ts';
import { errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { refusingSend } from './sign-fixture/test-support.ts';
import { invalidateAs, invalidatedAnswerOf } from './signature-invalidate-fixture/test-support.ts';
import { enforceDocuments, revokeWorld, signatureCore } from './signature-revoke-fixture/test-support.ts';

// What an invalidation of a major leaves alone and what it sends (E15-S04): the signers, their personal data and the versions of the
// document are not touched, nobody is told, a pull request that is closed keeps its row and its Check Run, each repository that
// enforces the document gets one sweep, and the sweeps commit with the revocations or not at all.

/** Tenant 1 with two more signatures of major 1 (three in force), both repositories enforcing the document, the queue of the app being `enqueuer`. */
async function crowd(enqueuer: JobEnqueuer = fakeEnqueuer()) {
  const world = await revokeWorld(enqueuer);
  await enforceDocuments(world);
  await addSignatures(world.db, majorOneOf(world.t1), 2, 50_000);
  const target = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  return { ...world, target };
}

test('the signers are neither deleted nor changed: their rows, their personal data and the core of every signature are the same, and no version of the document changes', async () => {
  const world = await crowd();
  const { db, t1, target } = world;
  const untouched = async () => {
    const all = await tablesOf(world);
    return Object.fromEntries(Object.entries(all).filter(([table]) => table !== 'signatures' && table !== 'audit_log'));
  };
  const ids = (await signatureStates(db, t1.documentId)).map((row) => row.id);
  const cores = async () => Promise.all(ids.map((id) => signatureCore(world, id)));
  const [coresBefore, restBefore] = [await cores(), await untouched()];
  const versions = () => db.selectFrom('cla_versions').selectAll().orderBy('id').execute();
  const documents = () => db.selectFrom('cla_documents').selectAll().orderBy('id').execute();
  const [versionsBefore, documentsBefore] = [await versions(), await documents()];
  const piiBefore = await db.selectFrom('signer_pii').selectAll().orderBy('signature_id').execute();
  const response = await invalidateAs(world, 'admin1', target, 3);
  expect(invalidatedAnswerOf(response)).toEqual({ invalidated: 3 });
  expect(await cores()).toEqual(coresBefore);
  expect(await untouched()).toEqual(restBefore);
  expect(await versions()).toEqual(versionsBefore);
  expect(await documents()).toEqual(documentsBefore);
  expect(await db.selectFrom('signer_pii').selectAll().orderBy('signature_id').execute()).toEqual(piiBefore);
  expect(piiBefore).not.toEqual([]);
});

test('the invalidation is prospective: the rows of the evaluations are untouched, the closed pull request keeps its row and its Check Run, and no job is sent for any pull request', async () => {
  const world = await crowd();
  const { db, t1, people, target } = world;
  const relied = coveredBy({ githubId: people.member1.githubId, signatureId: t1.signatureId });
  await storePr(db, t1, 'plain', { prNumber: 61, details: relied });
  await storePr(db, t1, 'plain', { prNumber: 62, details: relied, state: 'closed' });
  await db.updateTable('pr_evaluations').set({ check_run_id: 123_456 }).where('pr_number', '=', 62).execute();
  const evaluations = () => db.selectFrom('pr_evaluations').selectAll().orderBy('id').execute();
  const before = await evaluations();
  const response = await invalidateAs(world, 'admin1', target, 3);
  expect(response.statusCode).toBe(200);
  expect(await evaluations()).toEqual(before);
  expect(before.filter((row) => row.pr_number === 62).map((row) => [row.pr_state, row.check_run_id])).toEqual([
    ['closed', 123_456],
  ]);
  expect((await sentJobs(db)).map(({ job }) => job.type)).toEqual(['sweep-repository', 'sweep-repository']);
});

test('each repository that enforces the document gets one sweep, with the reason signatures_invalidated, and a repository that does not enforce it gets none', async () => {
  const world = await crowd();
  const { db, t1, target } = world;
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.scoped.repositoryId).execute();
  const response = await invalidateAs(world, 'admin1', target, 3);
  expect(response.statusCode).toBe(200);
  expect((await sentJobs(db)).map(({ job }) => job)).toEqual([
    {
      type: 'sweep-repository',
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.plain.githubRepoId,
      reason: 'signatures_invalidated',
    },
  ]);
});

test('a queue that fails after the first of the sweeps rolls the invalidation back: 500, every signature is in force, no audit row, no sweep, and no table has changed', async () => {
  const world = await crowd(refusingSend(fakeEnqueuer(), 2));
  const { db, t1, target } = world;
  const before = await tablesOf(world);
  const response = await invalidateAs(world, 'admin1', target, 3);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([500, 'internal_server_error']);
  expect(response.body).not.toContain('zzzz');
  expect((await signatureStates(db, t1.documentId)).map((row) => row.revoked_at)).toEqual([null, null, null]);
  expect(await invalidationAuditRows(db)).toEqual([]);
  expect(await sentJobs(db)).toEqual([]);
  expect(await tablesOf(world)).toEqual(before);
});

test('the same request when the queue is back invalidates: 200, one sweep for each repository, one audit row', async () => {
  const queue = switchableEnqueuer(fakeEnqueuer());
  const world = await crowd(queue);
  const { db, t1, target } = world;
  queue.failWith(new Error('zzzz the queue is down'));
  const down = await invalidateAs(world, 'admin1', target, 3);
  queue.failWith(undefined);
  const back = await invalidateAs(world, 'admin1', target, 3);
  expect([down.statusCode, back.statusCode]).toEqual([500, 200]);
  expect(await sentAs(db)).toEqual([`sweep ${t1.plain.githubRepoId}`, `sweep ${t1.scoped.githubRepoId}`]);
  expect(await invalidationAuditRows(db)).toHaveLength(1);
});
