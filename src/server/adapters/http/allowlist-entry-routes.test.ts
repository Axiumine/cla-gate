// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  ADA,
  accountOf,
  addedEntries,
  addToInstallation,
  addToRepository,
  allowlistWorld,
  createdAuditRows,
  DEPENDABOT,
  entryOf,
  sweeps,
} from './allowlist-entry-fixture/test-support.ts';
import { errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { pointAt } from './repository-document-fixture/test-support.ts';

// POST /api/installations/:installationId/allowlist-entries and POST /api/repositories/:repositoryId/allowlist-entries (E14-S06):
// what an add stores, answers and audits, on the real application over PGlite. The refusals are in allowlist-entry-rules.test.ts, the
// sweeps and the queue in allowlist-entry-jobs.test.ts, the other tenant's ids in allowlist-entry-tenants.test.ts.

test('the org admin adds a person by login: 201, the entry as GitHub knows the account, stored by its numeric id, nothing cached', async () => {
  const world = await allowlistWorld();
  const { t1, people } = world;
  const response = await addToInstallation(world, 'admin1', t1.installationId, { kind: 'user', login: 'ada-lovelace' });
  expect(response.statusCode).toBe(201);
  expect(response.headers['cache-control']).toBe('no-store');
  const entry = entryOf(response);
  const [stored] = await addedEntries(world);
  expect(entry).toEqual({
    id: stored?.id,
    scope: 'installation',
    repositoryId: null,
    kind: 'user',
    githubId: 4711,
    loginSnapshot: 'Ada-Lovelace',
    createdBy: { githubId: people.admin1.githubId },
    createdAt: stored?.created_at.toISOString(),
  });
  const sent = z.object({ entry: z.record(z.string(), z.json()) }).parse(response.json());
  expect(Object.keys(sent.entry).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'createdAt',
    'createdBy',
    'githubId',
    'id',
    'kind',
    'loginSnapshot',
    'repositoryId',
    'scope',
  ]);
});

test('the row keeps the id GitHub answered with and the login in the case GitHub keeps, whatever case was typed, and the typed text is stored nowhere', async () => {
  const world = await allowlistWorld([accountOf(4712, 'Zzzz-Typist')]);
  const response = await addToInstallation(world, 'admin1', world.t1.installationId, {
    kind: 'user',
    login: 'ZZZZ-TYPIST',
  });
  expect(response.statusCode).toBe(201);
  expect(await addedEntries(world)).toMatchObject([
    {
      installation_id: world.t1.installationId,
      repository_id: null,
      kind: 'user',
      github_id: 4712,
      login_snapshot: 'Zzzz-Typist',
      created_by: world.people.admin1.userId,
    },
  ]);
  expect(JSON.stringify(await addedEntries(world))).not.toContain('ZZZZ-TYPIST');
});

test('an automation is added as a bot under its login with the [bot] suffix', async () => {
  const world = await allowlistWorld();
  const response = await addToInstallation(world, 'admin1', world.t1.installationId, {
    kind: 'bot',
    login: 'dependabot[bot]',
  });
  expect([response.statusCode, entryOf(response)]).toEqual([
    201,
    expect.objectContaining({ kind: 'bot', githubId: DEPENDABOT.id, loginSnapshot: 'dependabot[bot]' }),
  ]);
});

test('the members of the organisation are added without a login: the id and the login are those of the installation, after the App showed it may list them', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  const response = await addToInstallation(world, 'admin1', t1.installationId, { kind: 'org_members' });
  expect([response.statusCode, entryOf(response)]).toEqual([
    201,
    expect.objectContaining({
      scope: 'installation',
      kind: 'org_members',
      githubId: t1.accountId,
      loginSnapshot: t1.accountLogin,
    }),
  ]);
  expect(world.fakeGitHub.calls).toEqual([
    { method: 'probeMembersPermission', installationId: t1.githubInstallationId },
  ]);
});

test('the account is looked up with the token of the installation of the tenant, once', async () => {
  const world = await allowlistWorld();
  await addToInstallation(world, 'admin1', world.t1.installationId, { kind: 'user', login: 'ada-lovelace' });
  await addToInstallation(world, 'admin2', world.t2.installationId, { kind: 'user', login: 'ada-lovelace' });
  expect(world.fakeGitHub.calls).toEqual([
    { method: 'getUserAccount', installationId: world.t1.githubInstallationId },
    { method: 'getUserAccount', installationId: world.t2.githubInstallationId },
  ]);
});

test('the org admin adds an account for one repository: scope repository, the row names the repository', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  const response = await addToRepository(world, 'admin1', t1.plain.repositoryId, {
    kind: 'user',
    login: 'ada-lovelace',
  });
  expect(response.statusCode).toBe(201);
  expect(entryOf(response)).toMatchObject({ scope: 'repository', repositoryId: t1.plain.repositoryId, githubId: 4711 });
  expect(await addedEntries(world)).toMatchObject([
    { installation_id: t1.installationId, repository_id: t1.plain.repositoryId, github_id: 4711 },
  ]);
});

test('the admin of a repository whose document is its own adds an account for that repository, and the author is theirs', async () => {
  const world = await allowlistWorld();
  const { t1, people } = world;
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const response = await addToRepository(world, 'repoAdmin1', t1.scoped.repositoryId, { kind: 'org_members' });
  expect(response.statusCode).toBe(201);
  expect(entryOf(response)).toMatchObject({
    scope: 'repository',
    repositoryId: t1.scoped.repositoryId,
    kind: 'org_members',
    githubId: t1.accountId,
    createdBy: { githubId: people.repoAdmin1.githubId },
  });
});

test('the same account exists once for the installation and once for each repository, and a second add at the same scope is 409', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  const body = { kind: 'user', login: 'ada-lovelace' };
  const first = await addToInstallation(world, 'admin1', t1.installationId, body);
  const onPlain = await addToRepository(world, 'admin1', t1.plain.repositoryId, body);
  const onScoped = await addToRepository(world, 'admin1', t1.scoped.repositoryId, body);
  expect([first.statusCode, onPlain.statusCode, onScoped.statusCode]).toEqual([201, 201, 201]);
  const auditedBefore = (await createdAuditRows(world)).length;
  const before = await tablesOf(world);
  const duplicates = [
    await addToInstallation(world, 'admin1', t1.installationId, { kind: 'user', login: 'ADA-LOVELACE' }),
    await addToRepository(world, 'admin1', t1.plain.repositoryId, body),
  ];
  expect(duplicates.map((duplicate) => [duplicate.statusCode, errorCodeOf(duplicate)])).toEqual([
    [409, 'allowlist_entry_exists'],
    [409, 'allowlist_entry_exists'],
  ]);
  expect(await tablesOf(world)).toEqual(before);
  expect(await createdAuditRows(world)).toHaveLength(auditedBefore);
  expect(await addedEntries(world)).toHaveLength(3);
});

test('the members of the organisation exist once per scope too: a second add is 409, the other scope is still free', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  const first = await addToInstallation(world, 'admin1', t1.installationId, { kind: 'org_members' });
  const again = await addToInstallation(world, 'admin1', t1.installationId, { kind: 'org_members' });
  const onRepository = await addToRepository(world, 'admin1', t1.plain.repositoryId, { kind: 'org_members' });
  expect([first.statusCode, again.statusCode, onRepository.statusCode]).toEqual([201, 409, 201]);
  expect(errorCodeOf(again)).toBe('allowlist_entry_exists');
});

test('a person and a bot with the same numeric id are two entries, because the kind is part of the key', async () => {
  const world = await allowlistWorld([accountOf(4711, 'ada-lovelace'), accountOf(4711, 'ada-lovelace-bot', 'Bot')]);
  const person = await addToInstallation(world, 'admin1', world.t1.installationId, {
    kind: 'user',
    login: 'ada-lovelace',
  });
  const bot = await addToInstallation(world, 'admin1', world.t1.installationId, {
    kind: 'bot',
    login: 'ada-lovelace-bot',
  });
  expect([person.statusCode, bot.statusCode]).toEqual([201, 201]);
});

test('one audit row is written in the transaction of the add: the ids, the scope and the kind, and no login of the account', async () => {
  const world = await allowlistWorld([accountOf(4713, 'zzzz-person')]);
  const { t1, people } = world;
  await addToInstallation(world, 'admin1', t1.installationId, { kind: 'user', login: 'zzzz-person' });
  await addToRepository(world, 'admin1', t1.plain.repositoryId, { kind: 'user', login: 'zzzz-person' });
  const [installation, repository, ...others] = await createdAuditRows(world);
  const stored = await addedEntries(world);
  expect(others).toEqual([]);
  expect(installation).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    subject_type: 'allowlist_entry',
    subject_id: stored[0]?.id,
    metadata: { scope: 'installation', repository_id: null, kind: 'user', github_id: 4713 },
  });
  expect(repository).toMatchObject({
    subject_id: stored[1]?.id,
    metadata: { scope: 'repository', repository_id: t1.plain.repositoryId, kind: 'user', github_id: 4713 },
  });
  expect(JSON.stringify([installation, repository])).not.toContain('zzzz-person');
});

test('the add of an account for an installation whose repositories are all off sends no sweep: nothing enforces the CLA yet', async () => {
  const world = await allowlistWorld([ADA]);
  await world.db.updateTable('repositories').set({ enabled: false }).execute();
  const response = await addToInstallation(world, 'admin1', world.t1.installationId, {
    kind: 'user',
    login: 'ada-lovelace',
  });
  expect(response.statusCode).toBe(201);
  expect(await sweeps(world)).toEqual([]);
});
