// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { seedSignature, seedTenant } from '../adapters/db/test-support.ts';
import {
  auditActions,
  auditRows,
  installationRows,
  OWNER,
  remoteInstallation,
  remoteRepositories,
  repositoryRows,
  stateOf,
  syncWorld,
} from './sync-fixture/test-support.ts';

const id = parseGithubId;

test('GitHub answering 404 marks the stored installation and all its repositories, and audits the uninstall', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 3));
  await sync.syncInstallation(id(11));
  clock.advance(60_000);
  fake.removeInstallation(id(11));
  const outcome = await sync.syncInstallation(id(11));
  expect(outcome).toEqual({ status: 'deleted', changed: true, repositories: { added: 0, renamed: 0, removed: 3 } });
  expect((await installationRows(db))[0]).toMatchObject({ deleted_at: clock.now(), last_synced_at: clock.now() });
  expect((await repositoryRows(db)).map((row) => row.removed_at)).toEqual([clock.now(), clock.now(), clock.now()]);
  const rows = await auditRows(db);
  expect(rows.at(-1)).toMatchObject({
    action: 'installation.deleted',
    actor_github_id: null,
    subject_type: 'installation',
    subject_id: 11,
    metadata: { account_id: OWNER, account_type: 'organization', count: 3 },
  });
  expect(await auditActions(db)).not.toContain('repository.removed');
});

test('an uninstall keeps every row: the signatures, documents and repositories of the tenant stay', async () => {
  const { sync, db } = await syncWorld();
  const tenant = await seedTenant(db, 1);
  await seedSignature(db, tenant, 77_001);
  const before = await db.selectFrom('signatures').selectAll().execute();
  const [stored] = await installationRows(db);
  await sync.syncInstallation(id(stored?.github_installation_id ?? 0));
  expect((await installationRows(db))[0]?.deleted_at).not.toBeNull();
  expect(await db.selectFrom('signatures').selectAll().execute()).toEqual(before);
  expect(await db.selectFrom('cla_documents').select('id').execute()).toHaveLength(1);
  expect(await db.selectFrom('repositories').select('id').execute()).toHaveLength(1);
});

test('GitHub answering 404 for an installation that is not stored does nothing', async () => {
  const { sync, db } = await syncWorld();
  expect(await sync.syncInstallation(id(11))).toEqual({
    status: 'unknown',
    changed: false,
    repositories: { added: 0, renamed: 0, removed: 0 },
  });
  expect(await stateOf(db)).toEqual({ installations: [], repositories: [], audit: [] });
});

test('a second 404 for an installation already marked deleted writes nothing and audits nothing', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 1));
  await sync.syncInstallation(id(11));
  fake.removeInstallation(id(11));
  await sync.syncInstallation(id(11));
  const before = await stateOf(db);
  clock.advance(60_000);
  expect(await sync.syncInstallation(id(11))).toMatchObject({ status: 'deleted', changed: false });
  expect(await stateOf(db)).toEqual(before);
  expect((await auditActions(db)).filter((action) => action === 'installation.deleted')).toHaveLength(1);
});

test('a rejected installation that is uninstalled is marked deleted too, with no repositories to remove', async () => {
  const { fake, sync, db } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, 5000));
  await sync.syncInstallation(id(11));
  fake.removeInstallation(id(11));
  expect(await sync.syncInstallation(id(11))).toMatchObject({ status: 'deleted', changed: true });
  expect(await auditActions(db)).toEqual(['installation.rejected', 'installation.deleted']);
  expect((await auditRows(db)).at(-1)?.metadata).toMatchObject({ count: 0 });
});

test('a deleted row is not revived when GitHub lists the id again: the run warns and writes nothing', async () => {
  const { fake, sync, db, logs } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 1));
  await sync.syncInstallation(id(11));
  fake.removeInstallation(id(11));
  await sync.syncInstallation(id(11));
  const before = await stateOf(db);
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 1));
  fake.calls.length = 0;
  expect(await sync.syncInstallation(id(11))).toMatchObject({ status: 'deleted', changed: false });
  expect(await stateOf(db)).toEqual(before);
  expect(fake.calls.map((call) => call.method)).toEqual(['getInstallation']);
  expect(logs.lines().find((line) => line['msg'] === 'installation.deleted_still_listed')).toMatchObject({
    level: 40,
    githubInstallationId: 11,
  });
});
