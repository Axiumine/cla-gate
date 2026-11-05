// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { invalidationAuditRows, signatureStates } from '../../services/invalidation-fixture/test-support.ts';
import { errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import {
  invalidateAs,
  invalidatedAnswerOf,
  previewAnswerOf,
  previewAs,
} from './signature-invalidate-fixture/test-support.ts';
import { revokeWorld, scopedSignature } from './signature-revoke-fixture/test-support.ts';

// Who may preview and invalidate a major (E15-S04): the role follows the scope of the document, as for a revocation (E15-S03). The
// installation-wide document is for an org admin. The document of a repository is for the admin of that repository, and an org admin
// always. Everybody else is told nothing, and a person with a lower role is told so.

test('the installation-wide document is for an org admin: the admin of a repository is 403, a member and a stranger 404, nobody signed in 401, and nothing changes', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  const target = { installationId: t1.installationId, documentId: t1.documentId };
  const before = await tablesOf(world);
  const repoAdmin = await invalidateAs(world, 'repoAdmin1', target, 1);
  const others = [
    await invalidateAs(world, 'member1', target, 1),
    await invalidateAs(world, 'outsider', target, 1),
    await invalidateAs(world, 'admin2', target, 1),
    await invalidateAs(world, null, target, 1),
  ];
  expect([repoAdmin.statusCode, ...others.map((answer) => answer.statusCode)]).toEqual([403, 404, 404, 404, 401]);
  expect(errorCodeOf(repoAdmin)).toBe('forbidden');
  expect(await tablesOf(world)).toEqual(before);
  expect(await invalidationAuditRows(world.db)).toEqual([]);
  const allowed = await invalidateAs(world, 'admin1', target, 1);
  expect([allowed.statusCode, invalidatedAnswerOf(allowed)]).toEqual([200, { invalidated: 1 }]);
});

test('the preview of the installation-wide document is for an org admin too: the admin of a repository is 403, a member and a stranger 404, nobody signed in 401', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  const target = { installationId: t1.installationId, documentId: t1.documentId };
  const answers = [
    await previewAs(world, 'repoAdmin1', target),
    await previewAs(world, 'member1', target),
    await previewAs(world, 'outsider', target),
    await previewAs(world, 'admin2', target),
    await previewAs(world, null, target),
    await previewAs(world, 'admin1', target),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([403, 404, 404, 404, 401, 200]);
  expect(answers.slice(5).map(previewAnswerOf)).toEqual([{ major: 1, activeSignatures: 1, affectedRepositories: 0 }]);
});

test('the document of a repository is invalidated by the admin of that repository, and by an org admin', async () => {
  const world = await revokeWorld();
  const { t1, people, db } = world;
  const target = { installationId: t1.installationId, documentId: t1.scoped.documentId };
  await scopedSignature(world, 6101);
  const byRepoAdmin = await invalidateAs(world, 'repoAdmin1', target, 1);
  await scopedSignature(world, 6102);
  const byOrgAdmin = await invalidateAs(world, 'admin1', target, 1);
  expect([byRepoAdmin.statusCode, byOrgAdmin.statusCode]).toEqual([200, 200]);
  expect((await invalidationAuditRows(db)).map((row) => [row.subject_id, row.actor_github_id])).toEqual([
    [t1.scoped.documentId, people.repoAdmin1.githubId],
    [t1.scoped.documentId, people.admin1.githubId],
  ]);
  expect((await signatureStates(db, t1.scoped.documentId)).map((row) => row.revoked_by)).toEqual([
    people.repoAdmin1.userId,
    people.admin1.userId,
  ]);
});

test('the document of a repository is previewed by the admin of that repository, and a member and a stranger are told nothing', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  const target = { installationId: t1.installationId, documentId: t1.scoped.documentId };
  await scopedSignature(world);
  const answers = [
    await previewAs(world, 'repoAdmin1', target),
    await previewAs(world, 'admin1', target),
    await previewAs(world, 'member1', target),
    await previewAs(world, 'outsider', target),
    await previewAs(world, 'admin2', target),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 404, 404, 404]);
  expect(answers.slice(0, 2).map((answer) => previewAnswerOf(answer).activeSignatures)).toEqual([1, 1]);
});

test('a member of the organisation and a stranger cannot invalidate a major of the document of a repository: 404, and nobody signed in is 401', async () => {
  const world = await revokeWorld();
  const { t1 } = world;
  const target = { installationId: t1.installationId, documentId: t1.scoped.documentId };
  await scopedSignature(world);
  const before = await tablesOf(world);
  const answers = [
    await invalidateAs(world, 'member1', target, 1),
    await invalidateAs(world, 'outsider', target, 1),
    await invalidateAs(world, 'admin2', target, 1),
    await invalidateAs(world, null, target, 1),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 401]);
  expect(await tablesOf(world)).toEqual(before);
});

test('the document of a repository that GitHub no longer lists is for an org admin only: the permission of anyone else on it cannot be checked, so the admin of the repository is told nothing', async () => {
  const world = await revokeWorld();
  const { t1, db } = world;
  const target = { installationId: t1.installationId, documentId: t1.scoped.documentId };
  await scopedSignature(world);
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z'), enabled: false })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const refused = await invalidateAs(world, 'repoAdmin1', target, 1);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([404, 'not_found']);
  expect((await signatureStates(db, t1.scoped.documentId)).map((row) => row.revoked_at)).toEqual([null]);
  expect((await invalidateAs(world, 'admin1', target, 1)).statusCode).toBe(200);
});
