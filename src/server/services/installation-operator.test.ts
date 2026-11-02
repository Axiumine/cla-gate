// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { createInstallationStore } from './installation-store.ts';
import { DECIDED_AT, installationOf, listed, repoId, undecidedInstallationOf } from './store-fixture/test-support.ts';

const LATER = new Date('2026-06-01T12:00:00Z');
const id = parseGithubId;

test('no installation, no entry', async () => {
  const { db } = await migratedTestDatabase();
  expect(await createInstallationStore(db).listInstallationsForOperator()).toEqual([]);
});

test('an installation is listed with its ids, snapshot, decision, times and repository counts, and nothing else', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  const row = await store.upsertInstallation(installationOf(1, { suspendedAt: LATER }));
  await store.upsertRepositories(row.id, [listed(1, 1), listed(1, 2), listed(1, 3)]);
  await store.markRepositoriesRemoved(row.id, [repoId(1, 3)], LATER);
  await store.setRepositoryEnabled(row.id, repoId(1, 1), true, id(41_898_282));
  expect(await store.listInstallationsForOperator()).toEqual([
    {
      githubInstallationId: 100,
      accountId: 1000,
      accountLogin: 'org-1',
      accountType: 'Organization',
      admissionStatus: 'admitted',
      admissionReason: null,
      admissionDecidedAt: DECIDED_AT,
      suspendedAt: LATER,
      deletedAt: null,
      repositories: { active: 2, enabled: 1, removed: 1 },
    },
  ]);
});

test('rejected, undecided and deleted installations are listed too, with the reason and the times they have', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  await store.upsertInstallation(
    installationOf(1, { admission: { status: 'rejected', reason: 'policy_changed', decidedAt: LATER } }),
  );
  await store.upsertInstallation(undecidedInstallationOf(2, { accountType: 'User' }));
  await store.upsertInstallation(installationOf(3, { deletedAt: LATER }));
  const list = await store.listInstallationsForOperator();
  expect(list.map((entry) => entry.githubInstallationId)).toEqual([100, 200, 300]);
  expect(list.map((entry) => [entry.admissionStatus, entry.admissionReason, entry.admissionDecidedAt])).toEqual([
    ['rejected', 'policy_changed', LATER],
    ['rejected', null, null],
    ['admitted', null, DECIDED_AT],
  ]);
  expect(list.map((entry) => [entry.accountType, entry.deletedAt])).toEqual([
    ['Organization', null],
    ['User', null],
    ['Organization', LATER],
  ]);
  expect(list.map((entry) => entry.repositories)).toEqual(
    Array.from({ length: 3 }, () => ({ active: 0, enabled: 0, removed: 0 })),
  );
});

test('the counts of one installation never include the repositories of another', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  const a = await store.upsertInstallation(installationOf(1));
  const b = await store.upsertInstallation(installationOf(2));
  await store.upsertRepositories(a.id, [listed(1, 1)]);
  await store.upsertRepositories(b.id, [listed(2, 1), listed(2, 2), listed(2, 3), listed(2, 4)]);
  await store.markRepositoriesRemoved(b.id, [repoId(2, 4)], LATER);
  await store.setRepositoryEnabled(b.id, repoId(2, 1), true, id(41_898_282));
  await store.setRepositoryEnabled(b.id, repoId(2, 2), true, id(41_898_282));
  const list = await store.listInstallationsForOperator();
  expect(list.map((entry) => [entry.githubInstallationId, entry.repositories])).toEqual([
    [100, { active: 1, enabled: 0, removed: 0 }],
    [200, { active: 3, enabled: 2, removed: 1 }],
  ]);
});

test('an entry carries no signer, no document, no surrogate key and no personal data', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  await store.upsertInstallation(installationOf(1));
  const [entry] = await store.listInstallationsForOperator();
  expect(Object.keys(entry ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'accountId',
    'accountLogin',
    'accountType',
    'admissionDecidedAt',
    'admissionReason',
    'admissionStatus',
    'deletedAt',
    'githubInstallationId',
    'repositories',
    'suspendedAt',
  ]);
});
