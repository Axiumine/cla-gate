// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { InstallationRowId } from '../db/installation-row-id.ts';
import {
  ADA,
  addedEntries,
  addToInstallation,
  addToRepository,
  allowlistWorld,
  createdAuditRows,
  entryOf,
} from './allowlist-entry-fixture/test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { pointAt } from './repository-document-fixture/test-support.ts';

// The cross-tenant checks of `POST .../allowlist-entries` (E14-S06): the other tenant's ids, the same account allowlisted in both
// tenants, and the admin of one repository against the installation and against the other repositories of it.

const MEMBERS = { kind: 'org_members' } as const;

/** The checksums of the tables `names` out of the checksums of all of them. */
const only = (tables: Awaited<ReturnType<typeof tablesOf>>, ...names: string[]) =>
  Object.entries(tables).filter(([table]) => names.includes(table));
const BODY = { kind: 'user', login: 'ada-lovelace' } as const;

test("the other tenant's installation and repository ids are 404 for either org admin, the answer for an id that exists nowhere, and no row changes", async () => {
  const world = await allowlistWorld();
  const unknownInstallation = await addToInstallation(world, 'admin1', 987_654, BODY);
  const unknownRepository = await addToRepository(world, 'admin1', 987_654, BODY);
  const before = await tablesOf(world);
  const installations = [
    await addToInstallation(world, 'admin1', world.t2.installationId, BODY),
    await addToInstallation(world, 'admin2', world.t1.installationId, BODY),
  ];
  const repositories = [
    await addToRepository(world, 'admin1', world.t2.plain.repositoryId, BODY),
    await addToRepository(world, 'admin1', world.t2.scoped.repositoryId, BODY),
    await addToRepository(world, 'admin2', world.t1.plain.repositoryId, BODY),
    await addToRepository(world, 'admin2', world.t1.scoped.repositoryId, BODY),
  ];
  expect([...installations, ...repositories].map((answer) => answer.statusCode)).toEqual([
    404, 404, 404, 404, 404, 404,
  ]);
  expect(installations.map(withoutRequestId)).toEqual(installations.map(() => withoutRequestId(unknownInstallation)));
  expect(repositories.map(withoutRequestId)).toEqual(repositories.map(() => withoutRequestId(unknownRepository)));
  expect(await tablesOf(world)).toEqual(before);
  expect(world.fakeGitHub.calls).toEqual([]);
});

test('a member of the organisation and a stranger are 404 on both routes, and nobody signed in is 401; GitHub is never asked', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  const answers = [
    await addToInstallation(world, 'member1', t1.installationId, BODY),
    await addToInstallation(world, 'outsider', t1.installationId, BODY),
    await addToRepository(world, 'member1', t1.plain.repositoryId, BODY),
    await addToRepository(world, 'outsider', t1.scoped.repositoryId, BODY),
    await addToInstallation(world, null, t1.installationId, BODY),
    await addToRepository(world, null, t1.plain.repositoryId, BODY),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404, 401, 401]);
  expect(await addedEntries(world)).toEqual([]);
  expect(world.fakeGitHub.calls).toEqual([]);
});

test('the admin of a repository cannot add an entry for the installation: 403, GitHub is not asked, and no row changes', async () => {
  const world = await allowlistWorld();
  const before = await tablesOf(world);
  const answers = [
    await addToInstallation(world, 'repoAdmin1', world.t1.installationId, BODY),
    await addToInstallation(world, 'repoAdmin1', world.t1.installationId, MEMBERS),
  ];
  expect(answers.map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual([
    [403, 'forbidden'],
    [403, 'forbidden'],
  ]);
  expect(await tablesOf(world)).toEqual(before);
  expect(world.fakeGitHub.calls).toEqual([]);
});

test('the admin of a repository cannot add an entry for a repository whose attached document covers the installation: 403, and no row changes', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.documentId);
  const before = await tablesOf(world);
  const answers = [
    await addToRepository(world, 'repoAdmin1', t1.scoped.repositoryId, BODY),
    await addToRepository(world, 'repoAdmin1', t1.plain.repositoryId, BODY),
  ];
  expect(answers.map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual([
    [403, 'forbidden'],
    [403, 'forbidden'],
  ]);
  expect(await tablesOf(world)).toEqual(before);
  expect(world.fakeGitHub.calls).toEqual([]);
  const org = await addToRepository(world, 'admin1', t1.scoped.repositoryId, BODY);
  expect(org.statusCode).toBe(201);
});

test('the admin of a repository cannot add an entry for another repository of the installation, and can for their own', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const other = await addToRepository(world, 'repoAdmin1', t1.plain.repositoryId, BODY);
  const own = await addToRepository(world, 'repoAdmin1', t1.scoped.repositoryId, BODY);
  expect([other.statusCode, own.statusCode]).toEqual([403, 201]);
  expect(entryOf(own).repositoryId).toBe(t1.scoped.repositoryId);
  expect(await addedEntries(world)).toHaveLength(1);
});

test('the role is judged again against the document the repository enforces when the entry is stored: a CLA that became installation-wide while GitHub answered is 403', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  world.fakeGitHub.beforeNext('getUserAccount', () => pointAt(world, t1.scoped.repositoryId, t1.documentId));
  const before = await tablesOf(world);
  const response = await addToRepository(world, 'repoAdmin1', t1.scoped.repositoryId, BODY);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
  const after = await tablesOf(world);
  expect(only(after, 'allowlist_entries', 'audit_log')).toEqual(only(before, 'allowlist_entries', 'audit_log'));
  expect(await addedEntries(world)).toEqual([]);
});

test('the same account is allowlisted in both tenants independently: each has its own row, and neither add is a duplicate of the other', async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  const first = await addToInstallation(world, 'admin1', t1.installationId, BODY);
  const second = await addToInstallation(world, 'admin2', t2.installationId, BODY);
  const again = await addToInstallation(world, 'admin1', t1.installationId, BODY);
  expect([first.statusCode, second.statusCode, again.statusCode]).toEqual([201, 201, 409]);
  expect((await addedEntries(world)).map((row) => [row.installation_id, row.github_id])).toEqual([
    [t1.installationId, ADA.id],
    [t2.installationId, ADA.id],
  ]);
  expect((await createdAuditRows(world)).map((row) => row.installation_id)).toEqual([
    t1.installationId,
    t2.installationId,
  ]);
});

test('the members of each organisation are that organisation: the id of the other is never listed', async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  await addToInstallation(world, 'admin1', t1.installationId, MEMBERS);
  await addToInstallation(world, 'admin2', t2.installationId, MEMBERS);
  expect((await addedEntries(world)).map((row) => [row.installation_id, row.github_id, row.login_snapshot])).toEqual([
    [t1.installationId, t1.accountId, t1.accountLogin],
    [t2.installationId, t2.accountId, t2.accountLogin],
  ]);
  expect(world.fakeGitHub.calls).toEqual([
    { method: 'probeMembersPermission', installationId: t1.githubInstallationId },
    { method: 'probeMembersPermission', installationId: t2.githubInstallationId },
  ]);
});

/** What tenant `installationId` holds of the two tables an add could touch by mistake: its allowlist entries and its repositories. */
async function rowsOf(world: Awaited<ReturnType<typeof allowlistWorld>>, installationId: InstallationRowId) {
  const { db } = world;
  return {
    allowlist: await db
      .selectFrom('allowlist_entries')
      .selectAll()
      .where('installation_id', '=', installationId)
      .execute(),
    repositories: await db
      .selectFrom('repositories')
      .selectAll()
      .where('installation_id', '=', installationId)
      .execute(),
  };
}

test('an entry for one repository of a tenant leaves the entries and the repositories of the other tenant as they were', async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  const other = await rowsOf(world, t2.installationId);
  await addToRepository(world, 'admin1', t1.plain.repositoryId, BODY);
  await addToInstallation(world, 'admin1', t1.installationId, BODY);
  expect(await rowsOf(world, t2.installationId)).toEqual(other);
});
