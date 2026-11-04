// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  allowlistWorld,
  deletedAuditRows,
  entryIdsOf,
  installationPageOf,
  listInstallationAs,
  removeEntryAs,
  storeEntries,
} from './allowlist-list-fixture/test-support.ts';
import { errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';

// `DELETE /api/installations/:installationId/allowlist-entries/:entryId` (E14-S07): what a removal deletes, answers and audits, on the
// real application over PGlite. The roles are in allowlist-entry-remove-rules.test.ts, the sweeps and the queue in
// allowlist-entry-remove-jobs.test.ts, the other tenant's ids in allowlist-entry-remove-tenants.test.ts.

test('the org admin removes an entry that covers the installation: 204 with no body, nothing cached, the row is gone and no other row is', async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  const [kept] = await storeEntries(world, [
    {
      installationId: t1.installationId,
      repositoryId: null,
      kind: 'bot',
      githubId: 4712,
      loginSnapshot: 'a-bot[bot]',
      createdBy: world.people.admin1.userId,
    },
  ]);
  const others = await entryIdsOf(world, t2.installationId);
  const response = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  expect([response.statusCode, response.body, response.headers['cache-control']]).toEqual([204, '', 'no-store']);
  expect((await entryIdsOf(world, t1.installationId)).filter((id) => id !== kept)).toHaveLength(1);
  expect(await entryIdsOf(world, t1.installationId)).not.toContain(t1.entryId);
  expect(await entryIdsOf(world, t2.installationId)).toEqual(others);
});

test('it is a hard delete: the row is not marked, it is not there, and the list no longer shows the entry', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  const row = await world.db
    .selectFrom('allowlist_entries')
    .selectAll()
    .where('id', '=', t1.entryId)
    .executeTakeFirst();
  expect(row).toBeUndefined();
  const page = installationPageOf(await listInstallationAs(world, 'admin1', t1.installationId));
  expect(page.entries).toEqual([]);
});

test('one audit row is written: the entry as the subject, the scope, the repository, the kind and the GitHub id, and no login', async () => {
  const world = await allowlistWorld();
  const { t1, people } = world;
  const [installation, repository] = await storeEntries(world, [
    {
      installationId: t1.installationId,
      repositoryId: null,
      kind: 'user',
      githubId: 4713,
      loginSnapshot: 'zzzz-person',
      createdBy: people.admin1.userId,
    },
    {
      installationId: t1.installationId,
      repositoryId: t1.plain.repositoryId,
      kind: 'bot',
      githubId: 4714,
      loginSnapshot: 'zzzz-person[bot]',
      createdBy: people.admin1.userId,
    },
  ]);
  await removeEntryAs(world, 'admin1', t1.installationId, installation ?? 0);
  await removeEntryAs(world, 'admin1', t1.installationId, repository ?? 0);
  const [first, second, ...others] = await deletedAuditRows(world);
  expect(others).toEqual([]);
  expect(first).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    action: 'allowlist_entry.deleted',
    subject_type: 'allowlist_entry',
    subject_id: installation,
    metadata: { scope: 'installation', repository_id: null, kind: 'user', github_id: 4713 },
  });
  expect(second).toMatchObject({
    subject_id: repository,
    metadata: { scope: 'repository', repository_id: t1.plain.repositoryId, kind: 'bot', github_id: 4714 },
  });
  expect(Object.keys(first?.metadata ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'github_id',
    'kind',
    'repository_id',
    'scope',
  ]);
  expect(JSON.stringify([first, second])).not.toContain('zzzz-person');
});

test('an entry of a repository is removed by the same path, from the installation', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  const repositoryEntry = await world.db
    .selectFrom('allowlist_entries')
    .select('id')
    .where('github_id', '=', 101)
    .executeTakeFirstOrThrow();
  const response = await removeEntryAs(world, 'admin1', t1.installationId, repositoryEntry.id);
  expect(response.statusCode).toBe(204);
  expect(await entryIdsOf(world, t1.installationId)).toEqual([t1.entryId]);
});

test('an unknown id, an entry removed already and an id of another tenant are the same 404, and no row changes', async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  const unknown = await removeEntryAs(world, 'admin1', t1.installationId, 987_654);
  const first = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  const again = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  const before = await tablesOf(world);
  const foreign = await removeEntryAs(world, 'admin1', t1.installationId, t2.entryId);
  expect([unknown.statusCode, first.statusCode, again.statusCode, foreign.statusCode]).toEqual([404, 204, 404, 404]);
  expect(errorCodeOf(unknown)).toBe('not_found');
  expect([again, foreign].map(withoutRequestId)).toEqual([withoutRequestId(unknown), withoutRequestId(unknown)]);
  expect(await tablesOf(world)).toEqual(before);
  expect(await deletedAuditRows(world)).toHaveLength(1);
});

test.each(['0', '01', '-1', 'abc', '1.5', '1e3', '9007199254740993'])(
  'the entry id %s in the path is 400 bad_request: only an id in plain digits names an entry',
  async (id) => {
    const world = await allowlistWorld();
    const response = await removeEntryAs(world, 'admin1', world.t1.installationId, id);
    expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
    expect(await deletedAuditRows(world)).toEqual([]);
  },
);

test('a removal asks GitHub nothing: the policy is ours and the cache of GitHub facts is not touched', async () => {
  const world = await allowlistWorld();
  const response = await removeEntryAs(world, 'admin1', world.t1.installationId, world.t1.entryId);
  expect(response.statusCode).toBe(204);
  expect(world.fakeGitHub.calls).toEqual([]);
});

test('a tenant that is suspended refuses the removal with the 409 of its state, and keeps the entry', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await suspendTenantOne(world);
  const response = await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'installation_suspended']);
  expect(await entryIdsOf(world, t1.installationId)).toContain(t1.entryId);
  expect(await deletedAuditRows(world)).toEqual([]);
});
