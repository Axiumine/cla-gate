// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  allowlistWorld,
  deletedAuditRows,
  entryIdsOf,
  removeEntryAs,
  storeEntries,
} from './allowlist-list-fixture/test-support.ts';
import { errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { pointAt } from './repository-document-fixture/test-support.ts';

// Who may remove an allowlist entry (E14-S07): the role follows the scope of the entry. One that covers the installation is for an org
// admin. One of a repository follows the repository-action rule of E14-S01: the admin of the repository while the document it enforces
// is its own, an org admin always. Everybody else is told nothing.

/** An entry of tenant 1 for the repository `repositoryId`, stored for `who` to remove; its id. */
async function entryOfRepository(
  world: Awaited<ReturnType<typeof allowlistWorld>>,
  repositoryId: number,
  githubId = 6001,
) {
  const [id] = await storeEntries(world, [
    {
      installationId: world.t1.installationId,
      repositoryId,
      kind: 'user',
      githubId,
      loginSnapshot: 'zzzz-person',
      createdBy: world.people.admin1.userId,
    },
  ]);
  return id ?? 0;
}

test('an entry that covers the installation is for an org admin: the admin of a repository is 403, a member and a stranger 404, nobody signed in 401', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  const before = await tablesOf(world);
  const repoAdmin = await removeEntryAs(world, 'repoAdmin1', t1.installationId, t1.entryId);
  const others = [
    await removeEntryAs(world, 'member1', t1.installationId, t1.entryId),
    await removeEntryAs(world, 'outsider', t1.installationId, t1.entryId),
    await removeEntryAs(world, 'admin2', t1.installationId, t1.entryId),
    await removeEntryAs(world, null, t1.installationId, t1.entryId),
  ];
  expect([repoAdmin.statusCode, ...others.map((answer) => answer.statusCode)]).toEqual([403, 404, 404, 404, 401]);
  expect(errorCodeOf(repoAdmin)).toBe('forbidden');
  expect(await tablesOf(world)).toEqual(before);
  expect(await deletedAuditRows(world)).toEqual([]);
});

test('an entry of a repository whose document is its own is removed by the admin of that repository, and by an org admin', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const one = await entryOfRepository(world, t1.scoped.repositoryId, 6001);
  const two = await entryOfRepository(world, t1.scoped.repositoryId, 6002);
  const byRepoAdmin = await removeEntryAs(world, 'repoAdmin1', t1.installationId, one);
  const byOrgAdmin = await removeEntryAs(world, 'admin1', t1.installationId, two);
  expect([byRepoAdmin.statusCode, byOrgAdmin.statusCode]).toEqual([204, 204]);
  expect((await deletedAuditRows(world)).map((row) => row.actor_github_id)).toEqual([
    world.people.repoAdmin1.githubId,
    world.people.admin1.githubId,
  ]);
});

test.each([
  ['the document of the organisation', (t1: { documentId: number }) => t1.documentId],
  ['no document', () => null],
])(
  'an entry of a repository that enforces %s is for an org admin only: the admin of the repository is 403, and the entry stays',
  async (_label, attached) => {
    const world = await allowlistWorld();
    const { t1 } = world;
    await pointAt(world, t1.scoped.repositoryId, attached(t1));
    const id = await entryOfRepository(world, t1.scoped.repositoryId);
    const refused = await removeEntryAs(world, 'repoAdmin1', t1.installationId, id);
    expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
    expect(await entryIdsOf(world, t1.installationId)).toContain(id);
    const allowed = await removeEntryAs(world, 'admin1', t1.installationId, id);
    expect(allowed.statusCode).toBe(204);
  },
);

test('the admin of one repository cannot remove an entry of another repository of the installation: 403', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const onPlain = await entryOfRepository(world, t1.plain.repositoryId);
  const refused = await removeEntryAs(world, 'repoAdmin1', t1.installationId, onPlain);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
  expect(await entryIdsOf(world, t1.installationId)).toContain(onPlain);
});

test('a member of the organisation and a stranger cannot remove an entry of a repository either: 404, and nobody signed in is 401', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const id = await entryOfRepository(world, t1.scoped.repositoryId);
  const answers = [
    await removeEntryAs(world, 'member1', t1.installationId, id),
    await removeEntryAs(world, 'outsider', t1.installationId, id),
    await removeEntryAs(world, 'admin2', t1.installationId, id),
    await removeEntryAs(world, null, t1.installationId, id),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 401]);
  expect(await entryIdsOf(world, t1.installationId)).toContain(id);
});

test('an entry of a repository that GitHub no longer lists can be removed by an org admin only: the permission of anyone else on it cannot be checked, so the admin of the repository is told nothing', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const id = await entryOfRepository(world, t1.scoped.repositoryId);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z'), enabled: false })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const refused = await removeEntryAs(world, 'repoAdmin1', t1.installationId, id);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([404, 'not_found']);
  expect(await entryIdsOf(world, t1.installationId)).toContain(id);
  const allowed = await removeEntryAs(world, 'admin1', t1.installationId, id);
  expect(allowed.statusCode).toBe(204);
  expect(await entryIdsOf(world, t1.installationId)).not.toContain(id);
});
