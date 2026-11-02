// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { GitHubResponseError } from './ports/github-errors.ts';
import {
  auditRows,
  installationRows,
  OWNER,
  remoteInstallation,
  remoteRepositories,
  remoteRepository,
  repositoryRows,
  stateOf,
  syncWorld,
} from './sync-fixture/test-support.ts';

const id = parseGithubId;
const ACTOR = id(41_898_282);

/** An admitted installation 11 whose repositories 100 to 102 are stored. */
async function synced() {
  const world = await syncWorld();
  world.fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 3));
  await world.sync.syncInstallation(id(11));
  const [installation] = await installationRows(world.db);
  return { ...world, installationId: installation?.id ?? 0 };
}

const actionsAfter = async (world: Awaited<ReturnType<typeof synced>>, skip: number) =>
  (await auditRows(world.db)).slice(skip).map((row) => [row.action, row.subject_type, row.subject_id, row.metadata]);

test('a repository GitHub lists for the first time is inserted with enforcement off and audited by its numeric id', async () => {
  const world = await synced();
  world.fake.setRepositories(id(11), [...remoteRepositories(100, 3), remoteRepository(200, 'acme/new')]);
  const outcome = await world.sync.syncInstallation(id(11));
  expect(outcome).toEqual({ status: 'synced', changed: true, repositories: { added: 1, renamed: 0, removed: 0 } });
  expect((await repositoryRows(world.db)).at(-1)).toMatchObject({
    github_repo_id: 200,
    full_name: 'acme/new',
    enabled: false,
    removed_at: null,
  });
  expect(await actionsAfter(world, 4)).toEqual([['repository.added', 'repository', 200, {}]]);
});

test('a known repository gets its full_name refreshed, keeps its enforcement flag, and the rename is audited', async () => {
  const world = await synced();
  await world.store.setRepositoryEnabled(world.installationId, id(101), true, ACTOR);
  world.fake.setRepositories(id(11), [
    remoteRepository(100),
    remoteRepository(101, 'new-owner/renamed'),
    remoteRepository(102),
  ]);
  const outcome = await world.sync.syncInstallation(id(11));
  expect(outcome.repositories).toEqual({ added: 0, renamed: 1, removed: 0 });
  const row = (await repositoryRows(world.db)).find((entry) => entry.github_repo_id === 101);
  expect(row).toMatchObject({ full_name: 'new-owner/renamed', enabled: true, removed_at: null });
  expect(await actionsAfter(world, 5)).toEqual([['repository.renamed', 'repository', 101, {}]]);
  const audit = JSON.stringify(await auditRows(world.db));
  expect(audit).not.toContain('new-owner');
  expect(audit).not.toContain('acme/');
});

test('a stored repository GitHub no longer lists is marked removed, the row stays, and the removal is audited', async () => {
  const world = await synced();
  world.fake.setRepositories(id(11), remoteRepositories(100, 2));
  world.clock.advance(60_000);
  const outcome = await world.sync.syncInstallation(id(11));
  expect(outcome).toEqual({ status: 'synced', changed: true, repositories: { added: 0, renamed: 0, removed: 1 } });
  const rows = await repositoryRows(world.db);
  expect(rows.map((row) => [row.github_repo_id, row.removed_at])).toEqual([
    [100, null],
    [101, null],
    [102, world.clock.now()],
  ]);
  expect(await actionsAfter(world, 4)).toEqual([
    ['repository.removed', 'repository', 102, { reason_code: 'not_listed' }],
  ]);
});

test('a removed repository that is listed again is brought back with its enforcement flag as it was', async () => {
  const world = await synced();
  await world.store.setRepositoryEnabled(world.installationId, id(102), true, ACTOR);
  world.fake.setRepositories(id(11), remoteRepositories(100, 2));
  await world.sync.syncInstallation(id(11));
  world.fake.setRepositories(id(11), remoteRepositories(100, 3));
  const outcome = await world.sync.syncInstallation(id(11));
  expect(outcome.repositories).toEqual({ added: 1, renamed: 0, removed: 0 });
  expect((await repositoryRows(world.db)).at(-1)).toMatchObject({
    github_repo_id: 102,
    removed_at: null,
    enabled: true,
  });
  expect((await actionsAfter(world, 4)).map((entry) => entry[0])).toEqual([
    'repository.enabled',
    'repository.removed',
    'repository.added',
  ]);
});

test('added, renamed and removed repositories in one run are written together, each with its audit row', async () => {
  const world = await synced();
  world.fake.setRepositories(id(11), [
    remoteRepository(100, 'acme/renamed'),
    remoteRepository(102),
    remoteRepository(300),
  ]);
  const outcome = await world.sync.syncInstallation(id(11));
  expect(outcome.repositories).toEqual({ added: 1, renamed: 1, removed: 1 });
  expect((await actionsAfter(world, 4)).map((entry) => [entry[0], entry[2]])).toEqual([
    ['repository.added', 300],
    ['repository.renamed', 100],
    ['repository.removed', 101],
  ]);
});

test('an empty list removes every repository: GitHub says the installation reaches none', async () => {
  const world = await synced();
  world.fake.setRepositories(id(11), []);
  expect((await world.sync.syncInstallation(id(11))).repositories).toEqual({ added: 0, renamed: 0, removed: 3 });
  expect((await repositoryRows(world.db)).every((row) => row.removed_at !== null)).toBe(true);
});

test('a repository change moves last_synced_at; a run with nothing to change does not', async () => {
  const world = await synced();
  const first = (await installationRows(world.db))[0]?.last_synced_at;
  world.clock.advance(60_000);
  await world.sync.syncInstallation(id(11));
  expect((await installationRows(world.db))[0]?.last_synced_at).toEqual(first);
  world.fake.setRepositories(id(11), remoteRepositories(100, 2));
  await world.sync.syncInstallation(id(11));
  expect((await installationRows(world.db))[0]?.last_synced_at).toEqual(world.clock.now());
});

test.each([
  ['pagination_limit', new GitHubResponseError('GET /installation/repositories', ['pagination_limit'])],
  ['an unavailable GitHub', new Error('GitHub is down')],
])('a listing that raises (%s) changes nothing and the error reaches the caller', async (_label, error) => {
  const world = await synced();
  world.fake.setRepositories(id(11), remoteRepositories(100, 1));
  const before = await stateOf(world.db);
  world.fake.failNext('listInstallationRepositories', error);
  await expect(world.sync.syncInstallation(id(11))).rejects.toBe(error);
  expect(await stateOf(world.db)).toEqual(before);
});
