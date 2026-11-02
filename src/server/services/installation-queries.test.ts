// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { createInstallationStore } from './installation-store.ts';
import {
  DECIDED_AT,
  installationOf,
  undecidedInstallationOf,
  worldOfTwoTenants,
} from './store-fixture/test-support.ts';

const LATER = new Date('2026-06-01T12:00:00Z');

test('a new installation is stored with the snapshot GitHub gave and the decision the caller made', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  const row = await store.upsertInstallation(installationOf(1));
  expect(row).toMatchObject({
    github_installation_id: 100,
    account_id: 1000,
    account_login: 'org-1',
    account_type: 'Organization',
    suspended_at: null,
    admission_status: 'admitted',
    admission_reason: null,
    admission_decided_at: DECIDED_AT,
    deleted_at: null,
    last_synced_at: null,
  });
  expect(await store.findInstallationByGithubId(parseGithubId(100))).toEqual(row);
});

test('an installation stored without a decision is rejected: it can never be evaluated by default', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  const row = await store.upsertInstallation(undecidedInstallationOf(1));
  expect(row).toMatchObject({ admission_status: 'rejected', admission_reason: null, admission_decided_at: null });
});

test('a second upsert refreshes the snapshot, keeps the row and its decision, and writes only what it is given', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  const first = await store.upsertInstallation(installationOf(1));
  const second = await store.upsertInstallation(
    undecidedInstallationOf(1, {
      accountLogin: 'renamed-org',
      accountType: 'User',
      suspendedAt: LATER,
      lastSyncedAt: LATER,
    }),
  );
  expect(second).toEqual({
    ...first,
    account_login: 'renamed-org',
    account_type: 'User',
    suspended_at: LATER,
    last_synced_at: LATER,
    updated_at: second.updated_at,
  });
  expect(second.updated_at.getTime()).toBeGreaterThanOrEqual(first.updated_at.getTime());
  expect(await db.selectFrom('installations').select('id').execute()).toHaveLength(1);
});

test('a decision, an uninstall and a lifting of the suspension are written when given', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  await store.upsertInstallation(installationOf(1, { suspendedAt: DECIDED_AT }));
  const row = await store.upsertInstallation(
    installationOf(1, {
      suspendedAt: null,
      admission: { status: 'rejected', reason: 'policy_changed', decidedAt: LATER },
      deletedAt: LATER,
    }),
  );
  expect(row).toMatchObject({
    suspended_at: null,
    admission_status: 'rejected',
    admission_reason: 'policy_changed',
    admission_decided_at: LATER,
    deleted_at: LATER,
  });
});

test('a known installation under a different account is refused, because the account is part of its identity', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  const first = await store.upsertInstallation(installationOf(1));
  const hijack = store.upsertInstallation(installationOf(1, { accountId: parseGithubId(999), accountLogin: 'other' }));
  await expect(hijack).rejects.toMatchObject({ code: '23001' });
  expect(await store.findInstallationByGithubId(parseGithubId(100))).toEqual(first);
});

test('an unknown GitHub installation id finds nothing', async () => {
  const { db } = await migratedTestDatabase();
  const store = createInstallationStore(db);
  await store.upsertInstallation(installationOf(1));
  expect(await store.findInstallationByGithubId(parseGithubId(101))).toBeNull();
});

test('upserting installation A changes no column of B, and finding A never returns B', async () => {
  const { db, store, a, b } = await worldOfTwoTenants();
  const untouched = await db
    .selectFrom('installations')
    .selectAll()
    .where('id', '=', b.installation.id)
    .executeTakeFirstOrThrow();
  await store.upsertInstallation(
    installationOf(1, {
      accountLogin: 'renamed',
      suspendedAt: LATER,
      admission: { status: 'rejected', reason: 'policy_changed', decidedAt: LATER },
      deletedAt: LATER,
      lastSyncedAt: LATER,
    }),
  );
  const afterwards = await db
    .selectFrom('installations')
    .selectAll()
    .where('id', '=', b.installation.id)
    .executeTakeFirstOrThrow();
  expect(afterwards).toEqual(untouched);
  const foundA = await store.findInstallationByGithubId(parseGithubId(a.installation.github_installation_id));
  expect(foundA?.id).toBe(a.installation.id);
  expect(foundA?.account_login).toBe('renamed');
});
