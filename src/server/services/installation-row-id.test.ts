// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { installationRowIdSchema } from '../adapters/db/installation-row-id.ts';
import { getInstallationById, markInstallationDeleted, markInstallationSynced } from './installation-queries.ts';
import { listActiveRepositoryIds } from './repository-queries.ts';
import { worldOfTwoTenants } from './store-fixture/test-support.ts';

// The two tenant keys have different types (E05-S06): `installations.id`, which every repository query filters on, and
// the GitHub installation id a webhook carries. Passing one where the other is meant must not compile. Each directive
// below is such a call; if a signature went back to a plain number, the directive would be unused and `yarn typecheck`
// would fail. The calls also run, and read nothing: the GitHub id 100 is the surrogate id of no tenant here.

const GITHUB_INSTALLATION_ID = parseGithubId(100);
const AT = new Date('2026-06-01T12:00:00Z');

test('a GitHub installation id is refused by every store method that takes the surrogate tenant key', async () => {
  const { store } = await worldOfTwoTenants();
  // @ts-expect-error -- the point of the test: a GithubId is not an installations.id
  expect(await store.findActiveRepositoryByGithubId(GITHUB_INSTALLATION_ID, parseGithubId(10_001))).toBeNull();
  // @ts-expect-error -- the point of the test: a GithubId is not an installations.id
  expect(await store.markRepositoriesRemoved(GITHUB_INSTALLATION_ID, [], AT)).toEqual([]);
  // @ts-expect-error -- the point of the test: a GithubId is not an installations.id
  const changes = await store.upsertRepositories(GITHUB_INSTALLATION_ID, []);
  expect(changes).toEqual({ added: [], renamed: [] });
  await expect(
    // @ts-expect-error -- the point of the test: a GithubId is not an installations.id
    store.setRepositoryEnabled(GITHUB_INSTALLATION_ID, parseGithubId(10_001), true, parseGithubId(41_898_282)),
  ).rejects.toThrow();
});

test('a GitHub installation id is refused by the queries that take the surrogate tenant key', async () => {
  const { db } = await worldOfTwoTenants();
  // @ts-expect-error -- the point of the test: a GithubId is not an installations.id
  await expect(getInstallationById(db, GITHUB_INSTALLATION_ID)).rejects.toThrow('no result');
  // @ts-expect-error -- the point of the test: a GithubId is not an installations.id
  expect(await listActiveRepositoryIds(db, GITHUB_INSTALLATION_ID)).toEqual([]);
  // @ts-expect-error -- the point of the test: a GithubId is not an installations.id
  await markInstallationSynced(db, GITHUB_INSTALLATION_ID, AT);
  // @ts-expect-error -- the point of the test: a GithubId is not an installations.id
  await markInstallationDeleted(db, GITHUB_INSTALLATION_ID, AT);
});

test('the id of a stored row is accepted, and an id that is not a positive integer cannot be made', async () => {
  const { db, a } = await worldOfTwoTenants();
  expect((await getInstallationById(db, a.installation.id)).github_installation_id).toBe(100);
  expect(() => installationRowIdSchema.parse(0)).toThrow();
  expect(() => installationRowIdSchema.parse(1.5)).toThrow();
});
