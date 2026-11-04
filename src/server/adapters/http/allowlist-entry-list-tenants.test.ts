// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ALLOWLIST_LOGIN_PATTERN } from '../../../shared/allowlist.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { httpWorld } from '../github/http-world/test-support.ts';
import { ADA, accountOf, addedEntries, addToInstallation, DEPENDABOT } from './allowlist-entry-fixture/test-support.ts';
import {
  allowlistWorld,
  installationPageOf,
  listInstallationAs,
  listRepositoryAs,
  repositoryPageOf,
  storeEntries,
} from './allowlist-list-fixture/test-support.ts';
import { ownerOf } from './cross-tenant-runner/test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';

// The cross-tenant checks of the lists of the allowlist (E14-S07): the other tenant's ids, the same account allowlisted in both tenants,
// and what a list may hold when GitHub answers with markup.

test("the other tenant's installation and repository ids are 404 for either org admin, the answer for an id that exists nowhere", async () => {
  const world = await allowlistWorld();
  const unknownInstallation = await listInstallationAs(world, 'admin1', 987_654);
  const unknownRepository = await listRepositoryAs(world, 'admin1', 987_654);
  const before = await tablesOf(world);
  const installations = [
    await listInstallationAs(world, 'admin1', world.t2.installationId),
    await listInstallationAs(world, 'admin2', world.t1.installationId),
  ];
  const repositories = [
    await listRepositoryAs(world, 'admin1', world.t2.plain.repositoryId),
    await listRepositoryAs(world, 'admin1', world.t2.scoped.repositoryId),
    await listRepositoryAs(world, 'admin2', world.t1.plain.repositoryId),
    await listRepositoryAs(world, 'admin2', world.t1.scoped.repositoryId),
  ];
  expect([...installations, ...repositories].map((answer) => answer.statusCode)).toEqual([
    404, 404, 404, 404, 404, 404,
  ]);
  expect(installations.map(withoutRequestId)).toEqual(installations.map(() => withoutRequestId(unknownInstallation)));
  expect(repositories.map(withoutRequestId)).toEqual(repositories.map(() => withoutRequestId(unknownRepository)));
  expect(await tablesOf(world)).toEqual(before);
  expect(world.fakeGitHub.calls).toEqual([]);
});

test('a list of tenant 1 holds rows of tenant 1 only, although tenant 2 exempts the very same accounts, for the installation and for a repository', async () => {
  const world = await allowlistWorld();
  const { t1, t2, people } = world;
  const same = (installationId: number, repositoryId: number | null, createdBy: number) => ({
    installationId,
    repositoryId,
    kind: 'user' as const,
    githubId: 4711,
    loginSnapshot: 'ada-lovelace',
    createdBy,
  });
  await storeEntries(world, [
    same(t1.installationId, null, people.admin1.userId),
    same(t1.installationId, t1.plain.repositoryId, people.admin1.userId),
    same(t2.installationId, null, people.admin2.userId),
    same(t2.installationId, t2.plain.repositoryId, people.admin2.userId),
  ]);
  const lists = [
    [t1, installationPageOf(await listInstallationAs(world, 'admin1', t1.installationId)).entries],
    [t2, installationPageOf(await listInstallationAs(world, 'admin2', t2.installationId)).entries],
    [t1, repositoryPageOf(await listRepositoryAs(world, 'admin1', t1.plain.repositoryId)).own],
    [t2, repositoryPageOf(await listRepositoryAs(world, 'admin2', t2.plain.repositoryId)).own],
    [t1, repositoryPageOf(await listRepositoryAs(world, 'admin1', t1.plain.repositoryId)).inherited],
    [t2, repositoryPageOf(await listRepositoryAs(world, 'admin2', t2.plain.repositoryId)).inherited],
  ] as const;
  for (const [tenant, entries] of lists) {
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect((await ownerOf(world.db, { table: 'allowlist_entries', id: entry.id })).installationId).toBe(
        tenant.installationId,
      );
    }
  }
  const [first, second] = lists;
  expect(first[1].map((entry) => entry.createdBy.githubId)).toContain(people.admin1.githubId);
  expect(second[1].map((entry) => entry.createdBy.githubId)).toContain(people.admin2.githubId);
});

test('the repository of tenant 1 inherits the entries of its own installation: the entries of tenant 2 are never inherited, whatever their kind', async () => {
  const world = await allowlistWorld();
  const { t1, t2, people } = world;
  await storeEntries(world, [
    {
      installationId: t2.installationId,
      repositoryId: null,
      kind: 'org_members',
      githubId: 9999,
      loginSnapshot: 'org-2',
      createdBy: people.admin2.userId,
    },
  ]);
  const page = repositoryPageOf(await listRepositoryAs(world, 'admin1', t1.scoped.repositoryId));
  expect(page.inherited.map((entry) => entry.githubId)).toEqual([100]);
  expect(page.own).toEqual([]);
});

/** The login GitHub is scripted to answer with: not a login, and carrying a marker that a request id cannot hold. */
const HOSTILE_LOGIN = '<img src=x onerror=zzzz>';

test('a login that GitHub answers with as markup is rejected at creation, and every string a list shows has the shape of a login', async () => {
  const github = await httpWorld(testGitHubKey());
  const world = await allowlistWorld([], undefined, github.client);
  const { t1, people } = world;
  github.addInstallation(
    {
      id: t1.githubInstallationId,
      account: { id: t1.accountId, login: 'org-1', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: t1.plain.githubRepoId, fullName: 'org-1/repo' }],
  );
  github.scriptUserAccount('ada-lovelace', accountOf(people.outsider.githubId, HOSTILE_LOGIN));
  const refused = await addToInstallation(world, 'admin1', t1.installationId, { kind: 'user', login: 'ada-lovelace' });
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([502, 'github_unavailable']);
  expect(refused.body).not.toContain('zzzz');
  expect(await addedEntries(world)).toEqual([]);
  github.scriptUserAccount('ada-lovelace', ADA);
  github.scriptUserAccount('dependabot[bot]', DEPENDABOT);
  const added = [
    await addToInstallation(world, 'admin1', t1.installationId, { kind: 'user', login: 'ada-lovelace' }),
    await addToInstallation(world, 'admin1', t1.installationId, { kind: 'bot', login: 'dependabot[bot]' }),
  ];
  expect(added.map((answer) => answer.statusCode)).toEqual([201, 201]);
  const listed = await listInstallationAs(world, 'admin1', t1.installationId);
  const strings = installationPageOf(listed).entries.flatMap((entry) => [entry.loginSnapshot, entry.createdBy.login]);
  expect(strings).toHaveLength(6);
  for (const text of strings) {
    expect(text === null || ALLOWLIST_LOGIN_PATTERN.test(text)).toBe(true);
  }
  expect(strings.filter((text) => text === null)).toHaveLength(1);
  expect(listed.body).not.toContain('zzzz');
});

test('the database refuses a login snapshot with markup even when a code path forgot to check, so no list can ever hold one', async () => {
  const world = await allowlistWorld();
  const { t1, people } = world;
  const hostile = storeEntries(world, [
    {
      installationId: t1.installationId,
      repositoryId: null,
      kind: 'user',
      githubId: 5555,
      loginSnapshot: HOSTILE_LOGIN,
      createdBy: people.admin1.userId,
    },
  ]);
  await expect(hostile).rejects.toThrow(/allowlist_entries_login_snapshot_shape/);
  const page = installationPageOf(await listInstallationAs(world, 'admin1', t1.installationId));
  expect(page.entries.map((entry) => entry.githubId)).toEqual([100]);
});
