// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { listInstallationAllowlist, listRepositoryAllowlist } from './allowlist-entry-list.ts';
import { brokenBy, publishWorld } from './publish-fixture/test-support.ts';

// The lists of the allowlist below the routes (E14-S07): the role the service judges itself, on the document the repository enforces
// when the list is read, which the guard of the route read a moment earlier.

const FORBIDDEN = { rule: 'forbidden', details: undefined };
const NOT_FOUND = { rule: 'not_found', details: undefined };

/** The first page of the list of the repository `repositoryId` of tenant 1, read as `role`. */
async function repositoryList(role: 'org_admin' | 'repo_admin', repositoryId: number) {
  const { db, scope } = await publishWorld();
  return listRepositoryAllowlist(db, scope, { repositoryId, role, limit: 10, from: null });
}

test('an admin of a repository is refused the list of the installation', async () => {
  const { db, scope } = await publishWorld();
  const request = { role: 'repo_admin', limit: 10, from: null } as const;
  expect(await brokenBy(listInstallationAllowlist(db, scope, request))).toEqual(FORBIDDEN);
  expect((await listInstallationAllowlist(db, scope, { ...request, role: 'org_admin' })).entries).toHaveLength(1);
});

test('an admin of a repository whom the guard let in is refused when the document the repository enforces is the organisation', async () => {
  const { t1 } = await publishWorld();
  expect(await brokenBy(repositoryList('repo_admin', t1.plain.repositoryId))).toEqual(FORBIDDEN);
  expect((await repositoryList('org_admin', t1.plain.repositoryId)).own).toHaveLength(1);
});

test('an admin of a repository reads the list when the document the repository enforces is its own, with the entries of the installation inherited', async () => {
  const { db, scope, t1 } = await publishWorld();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: t1.scoped.documentId })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const page = await listRepositoryAllowlist(db, scope, {
    repositoryId: t1.scoped.repositoryId,
    role: 'repo_admin',
    limit: 10,
    from: null,
  });
  expect([page.own, page.inherited.map((entry) => entry.id), page.next]).toEqual([[], [t1.entryId], null]);
});

test("a repository that does not exist or that is another tenant's is not_found, whatever the role", async () => {
  const { db, scope, t2 } = await publishWorld();
  const read = (repositoryId: number) =>
    brokenBy(listRepositoryAllowlist(db, scope, { repositoryId, role: 'org_admin', limit: 10, from: null }));
  expect([await read(987_654), await read(t2.plain.repositoryId)]).toEqual([NOT_FOUND, NOT_FOUND]);
});
