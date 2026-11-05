// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { coveredBy, sentAs, storePr } from '../../services/revocation-fixture/test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import {
  enforceDocuments,
  revokeAs,
  revokedAuditRows,
  revokeWorld,
  scopedSignature,
  signatureRow,
} from './signature-revoke-fixture/test-support.ts';

// The cross-tenant checks of the revocation of a signature (E15-S03): no signature id of the other tenant is revoked, under either
// installation's path, and the revocation in one tenant leaves the identical signature, and the pull requests, of the other where
// they are. The generic matrix (cross-tenant-matrix) runs the same route for every role; this file crosses the ids both ways.

test("tenant 1's admin cannot revoke tenant 2's signature, under tenant 2's path or under tenant 1's: the answer for an id that exists nowhere", async () => {
  const world = await revokeWorld();
  const { t1, t2 } = world;
  const unknown = await revokeAs(world, 'admin1', t1.installationId, 987_654);
  const before = await tablesOf(world);
  for (const installationId of [t2.installationId, t1.installationId]) {
    const answer = await revokeAs(world, 'admin1', installationId, t2.signatureId);
    expect([installationId, answer.statusCode, errorCodeOf(answer)]).toEqual([installationId, 404, 'not_found']);
    expect(withoutRequestId(answer)).toBe(withoutRequestId(unknown));
  }
  expect(await tablesOf(world)).toEqual(before);
  expect((await signatureRow(world, t2.signatureId)).revoked_at).toBeNull();
  expect(await revokedAuditRows(world)).toEqual([]);
});

test("tenant 2's signature id under tenant 1's path is 404 for the admin of tenant 1 and for the admin of tenant 2 alike, and the other way round", async () => {
  const world = await revokeWorld();
  const { t1, t2 } = world;
  const before = await tablesOf(world);
  const answers = [
    await revokeAs(world, 'admin1', t1.installationId, t2.signatureId),
    await revokeAs(world, 'admin2', t1.installationId, t2.signatureId),
    await revokeAs(world, 'admin2', t2.installationId, t1.signatureId),
    await revokeAs(world, 'admin2', t1.installationId, t1.signatureId),
    await revokeAs(world, 'repoAdmin1', t2.installationId, t1.signatureId),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404, 404]);
  expect(await tablesOf(world)).toEqual(before);
});

test('a signature of a repository document of tenant 1 is not reached through the path of tenant 2 by the admin of its repository', async () => {
  const world = await revokeWorld();
  const { t1, t2 } = world;
  const id = await scopedSignature(world);
  const before = await tablesOf(world);
  const answers = [
    await revokeAs(world, 'repoAdmin1', t2.installationId, id),
    await revokeAs(world, 'admin2', t2.installationId, id),
    await revokeAs(world, 'admin2', t1.installationId, id),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
  expect(await tablesOf(world)).toEqual(before);
});

test('a revocation in tenant 1 leaves the signature of tenant 2 in force and sends no job for the pull requests of tenant 2', async () => {
  const world = await revokeWorld();
  const { t1, t2, people } = world;
  await enforceDocuments(world);
  const details = coveredBy({ githubId: people.member1.githubId, signatureId: t1.signatureId });
  await storePr(world.db, t1, 'plain', { prNumber: 71, details });
  await storePr(world.db, t2, 'plain', { prNumber: 71, details });
  const response = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect(response.statusCode).toBe(200);
  expect(await sentAs(world.db)).toEqual([`${t1.plain.githubRepoId}#71`]);
  expect(
    (await sentJobs(world.db)).map(({ job }) => (job.type === 'evaluate-pr' ? job.githubInstallationId : 0)),
  ).toEqual([t1.githubInstallationId]);
  expect((await signatureRow(world, t2.signatureId)).revoked_at).toBeNull();
  expect((await revokedAuditRows(world)).map((row) => row.installation_id)).toEqual([t1.installationId]);
});
