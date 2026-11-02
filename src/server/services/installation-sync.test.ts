// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
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
const warnings = (lines: Record<string, unknown>[]) => lines.filter((line) => line['level'] === 40);

test('a new installation of the owner is stored, admitted and its repositories are inserted with enforcement off', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER, { login: 'acme' }), remoteRepositories(100, 3));
  const outcome = await sync.syncInstallation(id(11));
  expect(outcome).toEqual({ status: 'synced', changed: true, repositories: { added: 3, renamed: 0, removed: 0 } });
  expect(await installationRows(db)).toMatchObject([
    {
      github_installation_id: 11,
      account_id: OWNER,
      account_login: 'acme',
      account_type: 'Organization',
      admission_status: 'admitted',
      admission_reason: null,
      suspended_at: null,
      deleted_at: null,
      last_synced_at: clock.now(),
    },
  ]);
  const repositories = await repositoryRows(db);
  expect(repositories.map((row) => [row.github_repo_id, row.full_name, row.enabled, row.removed_at])).toEqual([
    [100, 'acme/repo-100', false, null],
    [101, 'acme/repo-101', false, null],
    [102, 'acme/repo-102', false, null],
  ]);
  expect(await auditActions(db)).toEqual([
    'installation.admitted',
    'repository.added',
    'repository.added',
    'repository.added',
  ]);
});

test('the state comes from GitHub, never from the caller: the id is all a sync is given', async () => {
  const { fake, sync, db } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER, { login: 'old-name' }), remoteRepositories(100, 1));
  await sync.syncInstallation(id(11));
  fake.addInstallation(remoteInstallation(11, OWNER, { login: 'new-name' }), remoteRepositories(100, 1));
  const outcome = await sync.syncInstallation(id(11));
  expect(outcome).toMatchObject({ status: 'synced', changed: true });
  expect((await installationRows(db))[0]).toMatchObject({ account_login: 'new-name' });
  expect(fake.calls.filter((call) => call.method === 'getInstallation')).toHaveLength(2);
});

test('a second run over unchanged state writes no row and no audit entry', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 3));
  await sync.syncInstallation(id(11));
  const before = await stateOf(db);
  clock.advance(3_600_000);
  const outcome = await sync.syncInstallation(id(11));
  expect(outcome).toEqual({ status: 'synced', changed: false, repositories: { added: 0, renamed: 0, removed: 0 } });
  expect(await stateOf(db)).toEqual(before);
});

test('a refreshed account login is stored without an audit row, and last_synced_at moves with the write', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER, { login: 'old' }));
  await sync.syncInstallation(id(11));
  clock.advance(60_000);
  fake.addInstallation(remoteInstallation(11, OWNER, { login: 'new' }));
  await sync.syncInstallation(id(11));
  expect((await installationRows(db))[0]).toMatchObject({ account_login: 'new', last_synced_at: clock.now() });
  expect(await auditActions(db)).toEqual(['installation.admitted']);
});

test('a rejected installation is recorded and stops there: no listing, no token, no repository row', async () => {
  const { fake, sync, db, store } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, 5000), remoteRepositories(100, 3));
  const outcome = await sync.syncInstallation(id(11));
  expect(outcome).toEqual({ status: 'rejected', changed: true, repositories: { added: 0, renamed: 0, removed: 0 } });
  expect(await store.findInstallationByGithubId(id(11))).toMatchObject({
    admission_status: 'rejected',
    admission_reason: 'account_not_allowed',
  });
  expect(fake.calls.map((call) => call.method)).toEqual(['getInstallation']);
  expect(await repositoryRows(db)).toEqual([]);
  expect(await auditActions(db)).toEqual(['installation.rejected']);
});

test('a second run on a rejected installation writes and logs nothing more', async () => {
  const { fake, sync, db, logs } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, 5000), remoteRepositories(100, 3));
  await sync.syncInstallation(id(11));
  const before = await stateOf(db);
  const loggedBefore = logs.lines().length;
  expect(await sync.syncInstallation(id(11))).toMatchObject({ status: 'rejected', changed: false });
  expect(await stateOf(db)).toEqual(before);
  expect(logs.lines()).toHaveLength(loggedBefore);
});

test('a suspension is audited once and the repositories are not listed; stored ones stay as they are', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 2));
  await sync.syncInstallation(id(11));
  fake.suspend(id(11), new Date(clock.now()));
  fake.calls.length = 0;
  const outcome = await sync.syncInstallation(id(11));
  expect(outcome).toEqual({ status: 'suspended', changed: true, repositories: { added: 0, renamed: 0, removed: 0 } });
  expect(fake.calls.map((call) => call.method)).toEqual(['getInstallation']);
  expect((await installationRows(db))[0]?.suspended_at).toEqual(clock.now());
  expect((await repositoryRows(db)).map((row) => row.removed_at)).toEqual([null, null]);
  expect(await sync.syncInstallation(id(11))).toMatchObject({ status: 'suspended', changed: false });
  expect((await auditActions(db)).filter((action) => action === 'installation.suspended')).toHaveLength(1);
});

test('an unsuspension is audited and the sync goes on to the repositories', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 1));
  await sync.syncInstallation(id(11));
  fake.suspend(id(11), clock.now());
  await sync.syncInstallation(id(11));
  fake.suspend(id(11), null);
  fake.setRepositories(id(11), remoteRepositories(100, 2));
  const outcome = await sync.syncInstallation(id(11));
  expect(outcome).toEqual({ status: 'synced', changed: true, repositories: { added: 1, renamed: 0, removed: 0 } });
  expect(await auditActions(db)).toEqual([
    'installation.admitted',
    'repository.added',
    'installation.suspended',
    'installation.unsuspended',
    'repository.added',
  ]);
  expect((await installationRows(db))[0]?.suspended_at).toBeNull();
});

test('an installation first seen suspended is admitted and suspended, and gets no repository row', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER, { suspendedAt: clock.now() }), remoteRepositories(100, 2));
  expect(await sync.syncInstallation(id(11))).toMatchObject({ status: 'suspended', changed: true });
  expect(await auditActions(db)).toEqual(['installation.admitted', 'installation.suspended']);
  expect(await repositoryRows(db)).toEqual([]);
});

test('the audit rows of a suspension name the installation and the account by number, for the system', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER, { suspendedAt: clock.now() }));
  await sync.syncInstallation(id(11));
  const [row] = (await auditRows(db)).filter((entry) => entry.action === 'installation.suspended');
  expect(row).toMatchObject({
    actor_github_id: null,
    subject_type: 'installation',
    subject_id: 11,
    metadata: { account_id: OWNER, account_type: 'organization' },
  });
});

test('a user account that is rejected and suspended is recorded as both, with the type user', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, 5000, { type: 'User', suspendedAt: clock.now() }));
  expect(await sync.syncInstallation(id(11))).toMatchObject({ status: 'rejected' });
  expect(await auditActions(db)).toEqual(['installation.rejected', 'installation.suspended']);
  expect((await installationRows(db))[0]).toMatchObject({ account_type: 'User', suspended_at: clock.now() });
});

test('missing permissions are one WARN naming them; the sync is not blocked', async () => {
  const { fake, sync, db, logs } = await syncWorld();
  const poor = { metadata: 'read', pull_requests: 'read', checks: 'write' };
  fake.addInstallation(remoteInstallation(11, OWNER, { permissions: poor }), remoteRepositories(100, 1));
  expect(await sync.syncInstallation(id(11))).toMatchObject({ status: 'synced', changed: true });
  const lines = warnings(logs.lines()).filter((line) => line['msg'] === 'installation.permissions_missing');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ githubInstallationId: 11, permissions: ['pull_requests', 'issues', 'members'] });
  expect(await repositoryRows(db)).toHaveLength(1);
});

test('an installation that grants enough logs no permission warning, and a rejected one is not examined', async () => {
  const { fake, sync, logs } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 1));
  fake.addInstallation(remoteInstallation(12, 5000, { permissions: {} }));
  await sync.syncInstallation(id(11));
  await sync.syncInstallation(id(12));
  expect(logs.lines().filter((line) => line['msg'] === 'installation.permissions_missing')).toEqual([]);
});
