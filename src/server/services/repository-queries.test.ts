// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { InsertQueryNode, type Kysely, type KyselyPlugin, ValuesNode } from 'kysely';
import { expect, test } from 'vitest';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { createInstallationStore } from './installation-store.ts';
import { isRepositoryEnabled, renameActiveRepository } from './repository-queries.ts';
import { REPOSITORY_BATCH_SIZE } from './repository-rows.ts';
import { listed, repoId, worldOfTwoTenants } from './store-fixture/test-support.ts';

const REMOVED_AT = new Date('2026-06-01T12:00:00Z');
const UNIQUE = { code: '23505' };

async function repositoriesOf(db: Kysely<Database>, installationId: InstallationRowId) {
  return await db
    .selectFrom('repositories')
    .selectAll()
    .where('installation_id', '=', installationId)
    .orderBy('github_repo_id')
    .execute();
}

test('new repositories are inserted with enforcement off and reported as added', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  const changes = await store.upsertRepositories(a.installation.id, [listed(1, 3), listed(1, 4)]);
  expect(changes).toEqual({ added: [repoId(1, 3), repoId(1, 4)], renamed: [] });
  const rows = await repositoriesOf(db, a.installation.id);
  expect(rows.map((row) => [row.github_repo_id, row.full_name, row.enabled, row.removed_at])).toEqual([
    [10_001, 'org-1/repo-1', false, null],
    [10_002, 'org-1/repo-2', false, null],
    [10_003, 'org-1/repo-3', false, null],
    [10_004, 'org-1/repo-4', false, null],
  ]);
});

test('a second run over the same listing changes no row and reports nothing', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  const before = await repositoriesOf(db, a.installation.id);
  expect(await store.upsertRepositories(a.installation.id, [listed(1, 1), listed(1, 2)])).toEqual({
    added: [],
    renamed: [],
  });
  expect(await repositoriesOf(db, a.installation.id)).toEqual(before);
});

test('a renamed repository keeps its row, its enforcement and its document, and is reported as renamed', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  await db.updateTable('repositories').set({ enabled: true }).where('github_repo_id', '=', repoId(1, 1)).execute();
  const before = await store.findActiveRepositoryByGithubId(a.installation.id, repoId(1, 1));
  const changes = await store.upsertRepositories(a.installation.id, [listed(1, 1, 'new-owner/new-name')]);
  expect(changes).toEqual({ added: [], renamed: [repoId(1, 1)] });
  const after = await store.findActiveRepositoryByGithubId(a.installation.id, repoId(1, 1));
  expect(after).toMatchObject({ id: before?.id, full_name: 'new-owner/new-name', enabled: true, removed_at: null });
});

test('a repository listed again after its removal is brought back with its enforcement as it was', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  await db.updateTable('repositories').set({ enabled: true }).where('github_repo_id', '=', repoId(1, 1)).execute();
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 1)], REMOVED_AT);
  expect(await store.findActiveRepositoryByGithubId(a.installation.id, repoId(1, 1))).toBeNull();
  const changes = await store.upsertRepositories(a.installation.id, [listed(1, 1, 'org-1/renamed-while-away')]);
  expect(changes).toEqual({ added: [repoId(1, 1)], renamed: [] });
  const back = await store.findActiveRepositoryByGithubId(a.installation.id, repoId(1, 1));
  expect(back).toMatchObject({ removed_at: null, enabled: true, full_name: 'org-1/renamed-while-away' });
  expect(await repositoriesOf(db, a.installation.id)).toHaveLength(2);
});

test('listing the same repository twice stores it once, with the last name', async () => {
  const { store, a } = await worldOfTwoTenants();
  const changes = await store.upsertRepositories(a.installation.id, [
    listed(1, 5, 'org-1/first'),
    listed(1, 5, 'org-1/last'),
  ]);
  expect(changes.added).toEqual([repoId(1, 5)]);
  expect(await store.findActiveRepositoryByGithubId(a.installation.id, repoId(1, 5))).toMatchObject({
    full_name: 'org-1/last',
  });
});

test('an empty listing writes nothing', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  const before = await repositoriesOf(db, a.installation.id);
  expect(await store.upsertRepositories(a.installation.id, [])).toEqual({ added: [], renamed: [] });
  expect(await repositoriesOf(db, a.installation.id)).toEqual(before);
});

/** Records the number of rows of every INSERT that reaches the database. */
function insertSizes(sizes: number[]): KyselyPlugin {
  return {
    transformQuery: ({ node }) => {
      if (InsertQueryNode.is(node) && node.values !== undefined && ValuesNode.is(node.values)) {
        sizes.push(node.values.values.length);
      }
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
}

test('2,501 repositories are written in one transaction as batches of at most 500 rows', async () => {
  const { db, a } = await worldOfTwoTenants();
  const sizes: number[] = [];
  const store = createInstallationStore(db.withPlugin(insertSizes(sizes)));
  const many = Array.from({ length: 2501 }, (_, index) => listed(1, 100 + index));
  const changes = await store.upsertRepositories(a.installation.id, many);
  expect(changes.added).toHaveLength(2501);
  expect(sizes).toEqual([500, 500, 500, 500, 500, 1]);
  expect(Math.max(...sizes)).toBe(REPOSITORY_BATCH_SIZE);
  expect(await repositoriesOf(db, a.installation.id)).toHaveLength(2503);
});

test('a conflict in the last batch leaves the earlier batches unwritten', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  const many = Array.from({ length: 501 }, (_, index) => listed(1, 100 + index));
  const stolen = { githubRepoId: b.repoIds[0], fullName: 'org-1/stolen' };
  await expect(store.upsertRepositories(a.installation.id, [...many.slice(0, 500), stolen])).rejects.toMatchObject(
    UNIQUE,
  );
  expect(await repositoriesOf(db, a.installation.id)).toHaveLength(2);
  expect(await repositoriesOf(db, b.installation.id)).toHaveLength(2);
});

test('inside the caller transaction the writes commit or roll back with it', async () => {
  const { db, a } = await worldOfTwoTenants();
  const rolledBack = db.transaction().execute(async (trx) => {
    const inside = createInstallationStore(trx);
    await inside.upsertRepositories(a.installation.id, [listed(1, 7)]);
    await inside.markRepositoriesRemoved(a.installation.id, [repoId(1, 1)], REMOVED_AT);
    throw new Error('the caller gave up');
  });
  await expect(rolledBack).rejects.toThrow('the caller gave up');
  const rows = await repositoriesOf(db, a.installation.id);
  expect(rows.map((row) => [row.github_repo_id, row.removed_at])).toEqual([
    [10_001, null],
    [10_002, null],
  ]);
});

test('removing marks the row and keeps it, and reports only the repositories that were active', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  const first = await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 1), repoId(1, 99)], REMOVED_AT);
  expect(first).toEqual([repoId(1, 1)]);
  const again = await store.markRepositoriesRemoved(
    a.installation.id,
    [repoId(1, 1)],
    new Date('2026-07-01T00:00:00Z'),
  );
  expect(again).toEqual([]);
  const rows = await repositoriesOf(db, a.installation.id);
  expect(rows.map((row) => [row.github_repo_id, row.removed_at])).toEqual([
    [10_001, REMOVED_AT],
    [10_002, null],
  ]);
});

test('removing an empty list writes nothing', async () => {
  const { store, a } = await worldOfTwoTenants();
  expect(await store.markRepositoriesRemoved(a.installation.id, [], REMOVED_AT)).toEqual([]);
  expect(await store.findActiveRepositoryByGithubId(a.installation.id, repoId(1, 1))).not.toBeNull();
});

test('removal of 1,200 repositories runs in batches and reports each of them', async () => {
  const { db, a } = await worldOfTwoTenants();
  const store = createInstallationStore(db);
  const many = Array.from({ length: 1200 }, (_, index) => listed(1, 100 + index));
  await store.upsertRepositories(a.installation.id, many);
  const removed = await store.markRepositoriesRemoved(
    a.installation.id,
    many.map((repository) => repository.githubRepoId),
    REMOVED_AT,
  );
  expect(removed).toHaveLength(1200);
  const active = await db
    .selectFrom('repositories')
    .select('id')
    .where('installation_id', '=', a.installation.id)
    .where('removed_at', 'is', null)
    .execute();
  expect(active).toHaveLength(2);
});

test('the active repository is found by installation and GitHub id, and not after removal', async () => {
  const { store, a } = await worldOfTwoTenants();
  expect(await store.findActiveRepositoryByGithubId(a.installation.id, repoId(1, 1))).toMatchObject({
    installation_id: a.installation.id,
    github_repo_id: 10_001,
    removed_at: null,
  });
  expect(await store.findActiveRepositoryByGithubId(a.installation.id, repoId(1, 99))).toBeNull();
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 1)], REMOVED_AT);
  expect(await store.findActiveRepositoryByGithubId(a.installation.id, repoId(1, 1))).toBeNull();
});

// ---------------------------------------------------------------------------------------------- cross-tenant

test('no function called with A id returns or changes a row of B', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  const target = b.repoIds[0];
  const before = await repositoriesOf(db, b.installation.id);

  expect(await store.findActiveRepositoryByGithubId(a.installation.id, target)).toBeNull();
  expect(await store.markRepositoriesRemoved(a.installation.id, [target], REMOVED_AT)).toEqual([]);
  await expect(
    store.upsertRepositories(a.installation.id, [{ githubRepoId: target, fullName: 'org-1/taken' }]),
  ).rejects.toMatchObject(UNIQUE);

  expect(await repositoriesOf(db, b.installation.id)).toEqual(before);
  expect(await store.findActiveRepositoryByGithubId(b.installation.id, target)).toMatchObject({
    full_name: 'org-2/repo-1',
  });
});

test('a sync of A renames and removes only its own rows when both tenants hold repositories', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  const before = await repositoriesOf(db, b.installation.id);
  await store.upsertRepositories(a.installation.id, [listed(1, 1, 'org-1/renamed'), listed(1, 3)]);
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 2)], REMOVED_AT);
  expect(await repositoriesOf(db, b.installation.id)).toEqual(before);
  expect(
    (await repositoriesOf(db, a.installation.id)).map((row) => [row.github_repo_id, row.full_name, row.removed_at]),
  ).toEqual([
    [10_001, 'org-1/renamed', null],
    [10_002, 'org-1/repo-2', REMOVED_AT],
    [10_003, 'org-1/repo-3', null],
  ]);
});

// ------------------------------------------------------------------------------------------------------ renaming

test('renaming gives the active repository its new name and changes no other column but the update time', async () => {
  const { db, a } = await worldOfTwoTenants();
  await db.updateTable('repositories').set({ enabled: true }).where('github_repo_id', '=', repoId(1, 1)).execute();
  const [before] = await repositoriesOf(db, a.installation.id);
  expect(await renameActiveRepository(db, a.installation.id, repoId(1, 1), 'new-owner/new-name')).toBe(true);
  const [after] = await repositoriesOf(db, a.installation.id);
  expect(after).toEqual({ ...before, full_name: 'new-owner/new-name', updated_at: after?.updated_at });
});

test('renaming to the name already stored, a removed repository or an unknown id changes nothing and says so', async () => {
  const { db, store, a } = await worldOfTwoTenants();
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 2)], REMOVED_AT);
  const before = await repositoriesOf(db, a.installation.id);
  expect(await renameActiveRepository(db, a.installation.id, repoId(1, 1), 'org-1/repo-1')).toBe(false);
  expect(await renameActiveRepository(db, a.installation.id, repoId(1, 2), 'org-1/elsewhere')).toBe(false);
  expect(await renameActiveRepository(db, a.installation.id, repoId(1, 99), 'org-1/elsewhere')).toBe(false);
  expect(await repositoriesOf(db, a.installation.id)).toEqual(before);
});

test('renaming with the id of A never renames a repository of B, whichever name it is given', async () => {
  const { db, a, b } = await worldOfTwoTenants();
  const before = await repositoriesOf(db, b.installation.id);
  expect(await renameActiveRepository(db, a.installation.id, b.repoIds[0], 'org-1/taken-over')).toBe(false);
  expect(await renameActiveRepository(db, a.installation.id, b.repoIds[0], 'org-2/repo-1')).toBe(false);
  expect(await repositoriesOf(db, b.installation.id)).toEqual(before);
});

test('renaming inside the caller transaction commits or rolls back with it', async () => {
  const { db, a } = await worldOfTwoTenants();
  await db
    .transaction()
    .execute(async (trx) => {
      expect(await renameActiveRepository(trx, a.installation.id, repoId(1, 1), 'org-1/rolled-back')).toBe(true);
      throw new Error('stop');
    })
    .catch(() => undefined);
  expect((await repositoriesOf(db, a.installation.id))[0]?.full_name).toBe('org-1/repo-1');
});

// ------------------------------------------------------------------------------------------------------ enforcement

test('enforcement is read off the row now: on is true, off and removed are false, and the repository of another installation is false (E14-S04)', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  const [first, second] = await repositoriesOf(db, a.installation.id);
  const [foreign] = await repositoriesOf(db, b.installation.id);
  if (first === undefined || second === undefined || foreign === undefined) {
    throw new Error('the world has no repositories');
  }
  await db.updateTable('repositories').set({ enabled: true }).execute();
  expect(await isRepositoryEnabled(db, a.installation.id, first.id)).toBe(true);
  expect(await isRepositoryEnabled(db, a.installation.id, foreign.id)).toBe(false);
  expect(await isRepositoryEnabled(db, b.installation.id, foreign.id)).toBe(true);
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', first.id).execute();
  expect(await isRepositoryEnabled(db, a.installation.id, first.id)).toBe(false);
  await store.markRepositoriesRemoved(a.installation.id, [repoId(1, 2)], REMOVED_AT);
  expect(await isRepositoryEnabled(db, a.installation.id, second.id)).toBe(false);
  expect(await isRepositoryEnabled(db, a.installation.id, 999_999)).toBe(false);
});
