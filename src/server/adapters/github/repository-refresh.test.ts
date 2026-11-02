// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createInstallationStore } from '../../services/installation-store.ts';
import { GitHubResponseError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { refreshRepositorySnapshot } from '../../services/repository-refresh.ts';
import { installationOf, listed, repoId } from '../../services/store-fixture/test-support.ts';
import { migratedTestDatabase } from '../db/test-support.ts';
import { clientFixture, json, type Routes, repositoryJson } from './client-fixture/test-support.ts';

// The snapshot refresh of E05-S09 over the Octokit adapter backed by MSW and a migrated database: what GitHub really
// answers for a repository the installation lost (404, or 403 for a missing permission) and what it must not be taken for.

/** Typed as `unknown` so the matcher does not leak an `any` into the test. */
const anyDate: unknown = expect.any(Date);
const INSTALLATION = installationOf(1);
const REPOSITORY = repoId(1, 1);

/** A stored installation with two repositories, and the adapter answering `routes`. */
async function worldWith(routes: Routes) {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  const installation = await store.upsertInstallation(INSTALLATION);
  await store.upsertRepositories(installation.id, [listed(1, 1), listed(1, 2)]);
  const fixture = clientFixture(routes);
  const refresh = () =>
    refreshRepositorySnapshot(
      { db, github: fixture.client, clock: fixture.clock },
      INSTALLATION.githubInstallationId,
      REPOSITORY,
    );
  const rows = () => db.selectFrom('repositories').selectAll().orderBy('github_repo_id').execute();
  const audit = () => db.selectFrom('audit_log').select(['action', 'subject_id', 'metadata']).orderBy('id').execute();
  return { refresh, rows, audit, fixture };
}

test.each([
  ['404', 404, 'Not Found'],
  ['403', 403, 'Resource not accessible by integration'],
])(
  'access lost (%s): the repository is marked removed, its row stays, and the other repository is untouched',
  async (_name, status, message) => {
    const { refresh, rows, audit } = await worldWith({ 'GET /repositories/:id': () => json({ message }, status) });
    const before = await rows();
    expect(await refresh()).toEqual({ status: 'removed', changed: true });
    const after = await rows();
    expect(after[1]).toEqual(before[1]);
    expect(after[0]).toMatchObject({ github_repo_id: REPOSITORY, removed_at: anyDate, enabled: false });
    expect(await audit()).toEqual([
      { action: 'repository.removed', subject_id: REPOSITORY, metadata: { reason_code: 'access_lost' } },
    ]);
    expect(await refresh()).toEqual({ status: 'not_stored', changed: false });
  },
);

test('a rename GitHub reports is stored, and the adapter was asked for the repository by its numeric id', async () => {
  const routes = { 'GET /repositories/:id': () => json(repositoryJson(REPOSITORY, 'org-1/renamed')) };
  const { refresh, rows, audit, fixture } = await worldWith(routes);
  expect(await refresh()).toEqual({ status: 'renamed', changed: true });
  expect((await rows())[0]).toMatchObject({ full_name: 'org-1/renamed', removed_at: null });
  expect(await audit()).toEqual([{ action: 'repository.renamed', subject_id: REPOSITORY, metadata: {} }]);
  expect(fixture.calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /repositories/${REPOSITORY}`]);
});

test('an answer that is not a repository fails the refresh and writes nothing', async () => {
  const { refresh, rows, audit } = await worldWith({ 'GET /repositories/:id': () => json({ id: REPOSITORY }) });
  const before = await rows();
  await expect(refresh()).rejects.toBeInstanceOf(GitHubResponseError);
  expect(await rows()).toEqual(before);
  expect(await audit()).toEqual([]);
});

test('GitHub being down is not access lost: the refresh fails and the repository stays active', async () => {
  const { refresh, rows, audit } = await worldWith({ 'GET /repositories/:id': () => json({ message: 'down' }, 503) });
  const before = await rows();
  await expect(refresh()).rejects.toBeInstanceOf(GitHubUnavailableError);
  expect(await rows()).toEqual(before);
  expect(await audit()).toEqual([]);
});
