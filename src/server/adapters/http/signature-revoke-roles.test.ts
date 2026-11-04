// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import {
  revokeAs,
  revokedAuditRows,
  revokeWorld,
  scopedSignature,
  signatureRow,
} from './signature-revoke-fixture/test-support.ts';

// Who may revoke a signature (E15-S03): the role follows the scope of the document the signature is on. A signature of an
// installation-wide document is for an org admin. One of a repository's own document is for the admin of that repository, and an org
// admin always. Everybody else is told nothing, and a person with a lower role is told so.

test('a signature on the installation-wide document is for an org admin: the admin of a repository is 403, a member and a stranger 404, nobody signed in 401', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  const before = await tablesOf(world);
  const repoAdmin = await revokeAs(world, 'repoAdmin1', t1.installationId, t1.signatureId);
  const others = [
    await revokeAs(world, 'member1', t1.installationId, t1.signatureId),
    await revokeAs(world, 'outsider', t1.installationId, t1.signatureId),
    await revokeAs(world, 'admin2', t1.installationId, t1.signatureId),
    await revokeAs(world, null, t1.installationId, t1.signatureId),
  ];
  expect([repoAdmin.statusCode, ...others.map((answer) => answer.statusCode)]).toEqual([403, 404, 404, 404, 401]);
  expect(errorCodeOf(repoAdmin)).toBe('forbidden');
  expect(await tablesOf(world)).toEqual(before);
  expect(await revokedAuditRows(world)).toEqual([]);
  const allowed = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect(allowed.statusCode).toBe(200);
});

test('a signature on the document of a repository is revoked by the admin of that repository, and by an org admin', async () => {
  const world = await revokeWorld();
  const { t1, people } = world;
  const one = await scopedSignature(world, 6101);
  const two = await scopedSignature(world, 6102);
  const byRepoAdmin = await revokeAs(world, 'repoAdmin1', t1.installationId, one);
  const byOrgAdmin = await revokeAs(world, 'admin1', t1.installationId, two);
  expect([byRepoAdmin.statusCode, byOrgAdmin.statusCode]).toEqual([200, 200]);
  expect((await revokedAuditRows(world)).map((row) => [row.subject_id, row.actor_github_id])).toEqual([
    [one, people.repoAdmin1.githubId],
    [two, people.admin1.githubId],
  ]);
  expect((await signatureRow(world, one)).revoked_by).toBe(people.repoAdmin1.userId);
});

test('a member of the organisation and a stranger cannot revoke a signature on the document of a repository either: 404, and nobody signed in is 401', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  const id = await scopedSignature(world);
  const before = await tablesOf(world);
  const answers = [
    await revokeAs(world, 'member1', t1.installationId, id),
    await revokeAs(world, 'outsider', t1.installationId, id),
    await revokeAs(world, 'admin2', t1.installationId, id),
    await revokeAs(world, null, t1.installationId, id),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 401]);
  expect(await tablesOf(world)).toEqual(before);
});

test('the admin of the repository is 403 on a signature of the installation-wide document, even for a repository that enforces it', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: t1.documentId })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const refused = await revokeAs(world, 'repoAdmin1', t1.installationId, t1.signatureId);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
  expect((await signatureRow(world, t1.signatureId)).revoked_at).toBeNull();
});

test('a signature on the document of a repository that GitHub no longer lists is revoked by an org admin only: the permission of anyone else on it cannot be checked, so the admin of the repository is told nothing', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  const id = await scopedSignature(world);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z'), enabled: false })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const refused = await revokeAs(world, 'repoAdmin1', t1.installationId, id);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([404, 'not_found']);
  expect((await signatureRow(world, id)).revoked_at).toBeNull();
  const allowed = await revokeAs(world, 'admin1', t1.installationId, id);
  expect(allowed.statusCode).toBe(200);
});
