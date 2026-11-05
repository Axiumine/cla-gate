// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  addSignatures,
  invalidationAuditRows,
  majorOneOf,
  signatureStates,
} from '../../services/invalidation-fixture/test-support.ts';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { sentAs } from '../../services/revocation-fixture/test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { invalidateAs, previewAnswerOf, previewAs } from './signature-invalidate-fixture/test-support.ts';
import { enforceDocuments, revokeWorld, scopedSignature } from './signature-revoke-fixture/test-support.ts';

// The cross-tenant checks of the invalidation of a major (E15-S04): no document id of the other tenant is previewed or invalidated,
// under either installation's path, and the invalidation of major 1 in one tenant leaves the same-numbered major of the other where it
// is. The generic matrix (cross-tenant-matrix) runs the same routes for every role; this file crosses the ids both ways.

test("tenant 1's admin can neither preview nor invalidate tenant 2's document, under tenant 2's path or under tenant 1's: the answer for an id that exists nowhere", async () => {
  const world = await revokeWorld();
  const { t1, t2 } = world;
  const unknown = { installationId: t1.installationId, documentId: 987_654 };
  const unknownInvalidation = await invalidateAs(world, 'admin1', unknown, 1);
  const unknownPreview = await previewAs(world, 'admin1', unknown);
  const before = await tablesOf(world);
  for (const installationId of [t2.installationId, t1.installationId]) {
    const target = { installationId, documentId: t2.documentId };
    const invalidation = await invalidateAs(world, 'admin1', target, 1);
    const preview = await previewAs(world, 'admin1', target);
    expect([installationId, invalidation.statusCode, errorCodeOf(invalidation)]).toEqual([
      installationId,
      404,
      'not_found',
    ]);
    expect([installationId, preview.statusCode, errorCodeOf(preview)]).toEqual([installationId, 404, 'not_found']);
    expect(withoutRequestId(invalidation)).toBe(withoutRequestId(unknownInvalidation));
    expect(withoutRequestId(preview)).toBe(withoutRequestId(unknownPreview));
  }
  expect(await tablesOf(world)).toEqual(before);
  expect(await invalidationAuditRows(world.db)).toEqual([]);
});

test("tenant 2's document id under tenant 1's path is 404 for the admin of either tenant, and tenant 1's under tenant 2's path too", async () => {
  const world = await revokeWorld();
  const { t1, t2 } = world;
  const before = await tablesOf(world);
  const answers = [
    await invalidateAs(world, 'admin1', { installationId: t1.installationId, documentId: t2.documentId }, 1),
    await invalidateAs(world, 'admin2', { installationId: t1.installationId, documentId: t2.documentId }, 1),
    await invalidateAs(world, 'admin2', { installationId: t2.installationId, documentId: t1.documentId }, 1),
    await invalidateAs(world, 'admin2', { installationId: t1.installationId, documentId: t1.documentId }, 1),
    await invalidateAs(world, 'repoAdmin1', { installationId: t2.installationId, documentId: t1.scoped.documentId }, 1),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404, 404]);
  expect(await tablesOf(world)).toEqual(before);
});

test('a document of a repository of tenant 1 is not reached through the path of tenant 2 by the admin of its repository', async () => {
  const world = await revokeWorld();
  const { t1, t2 } = world;
  await scopedSignature(world);
  const before = await tablesOf(world);
  const answers = [
    await invalidateAs(world, 'repoAdmin1', { installationId: t2.installationId, documentId: t1.scoped.documentId }, 1),
    await previewAs(world, 'repoAdmin1', { installationId: t2.installationId, documentId: t1.scoped.documentId }),
    await invalidateAs(world, 'admin2', { installationId: t1.installationId, documentId: t1.scoped.documentId }, 1),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
  expect(await tablesOf(world)).toEqual(before);
});

test("invalidating major 1 of tenant 1's document leaves major 1 of tenant 2's document untouched, and sweeps only the repositories of tenant 1", async () => {
  const world = await revokeWorld();
  await enforceDocuments(world);
  const { db, t1, t2 } = world;
  await addSignatures(db, majorOneOf(t1), 2, 50_000);
  await addSignatures(db, majorOneOf(t2), 2, 51_000);
  const others = await signatureStates(db, t2.documentId);
  const response = await invalidateAs(
    world,
    'admin1',
    { installationId: t1.installationId, documentId: t1.documentId },
    3,
  );
  expect(response.statusCode).toBe(200);
  expect(await signatureStates(db, t2.documentId)).toEqual(others);
  expect(others.map((row) => [row.major, row.revoked_at])).toEqual([
    [1, null],
    [1, null],
    [1, null],
  ]);
  expect((await invalidationAuditRows(db)).map((row) => row.installation_id)).toEqual([t1.installationId]);
  expect(await sentAs(db)).toEqual([`sweep ${t1.plain.githubRepoId}`, `sweep ${t1.scoped.githubRepoId}`]);
  expect(
    (await sentJobs(db)).map(({ job }) => (job.type === 'sweep-repository' ? job.githubInstallationId : 0)),
  ).toEqual([t1.githubInstallationId, t1.githubInstallationId]);
});

test("the invalidation of tenant 2's major 1 by its own admin leaves tenant 1's signatures in force, and the preview of each tenant counts its own only", async () => {
  const world = await revokeWorld();
  const { db, t1, t2 } = world;
  await addSignatures(db, majorOneOf(t1), 1, 50_000);
  const preview1 = await previewAs(world, 'admin1', { installationId: t1.installationId, documentId: t1.documentId });
  const preview2 = await previewAs(world, 'admin2', { installationId: t2.installationId, documentId: t2.documentId });
  expect([preview1, preview2].map((answer) => previewAnswerOf(answer).activeSignatures)).toEqual([2, 1]);
  const response = await invalidateAs(
    world,
    'admin2',
    { installationId: t2.installationId, documentId: t2.documentId },
    1,
  );
  expect(response.statusCode).toBe(200);
  expect((await signatureStates(db, t1.documentId)).map((row) => row.revoked_at)).toEqual([null, null]);
  expect((await invalidationAuditRows(db)).map((row) => row.installation_id)).toEqual([t2.installationId]);
});
