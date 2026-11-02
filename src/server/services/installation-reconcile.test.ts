// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { GitHubResponseError, GitHubUnavailableError } from './ports/github-errors.ts';
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

const methods = (calls: readonly { method: string }[]) => calls.map((call) => call.method);

test('every installation GitHub lists is synced, one after the other', async () => {
  const { fake, sync, db, logs } = await syncWorld([5000]);
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 2));
  fake.addInstallation(remoteInstallation(12, 5000), remoteRepositories(200, 1));
  fake.addInstallation(remoteInstallation(13, 6000), remoteRepositories(300, 1));
  expect(await sync.reconcileInstallations()).toEqual({ synced: 3, failed: 0 });
  expect(methods(fake.calls)).toEqual([
    'listInstallations',
    'getInstallation',
    'listInstallationRepositories',
    'getInstallation',
    'listInstallationRepositories',
    'getInstallation',
  ]);
  expect((await installationRows(db)).map((row) => [row.github_installation_id, row.admission_status])).toEqual([
    [11, 'admitted'],
    [12, 'admitted'],
    [13, 'rejected'],
  ]);
  expect(await repositoryRows(db)).toHaveLength(3);
  expect(logs.lines().find((line) => line['msg'] === 'installation.reconciled')).toMatchObject({
    level: 30,
    listed: 3,
    unlisted: 0,
    synced: 3,
    failed: 0,
  });
});

test('a second reconciliation over unchanged state writes nothing', async () => {
  const { fake, sync, db, clock } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 2));
  fake.addInstallation(remoteInstallation(13, 6000));
  await sync.reconcileInstallations();
  const before = await stateOf(db);
  clock.advance(3_600_000);
  expect(await sync.reconcileInstallations()).toEqual({ synced: 2, failed: 0 });
  expect(await stateOf(db)).toEqual(before);
});

test('a stored installation GitHub does not list is confirmed with getInstallation and marked deleted on a 404', async () => {
  const { fake, sync, db } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 2));
  fake.addInstallation(remoteInstallation(12, OWNER), remoteRepositories(200, 1));
  await sync.reconcileInstallations();
  fake.removeInstallation(id(12));
  fake.calls.length = 0;
  expect(await sync.reconcileInstallations()).toEqual({ synced: 2, failed: 0 });
  expect(fake.calls.filter((call) => call.method === 'getInstallation').map((call) => call.installationId)).toEqual([
    11, 12,
  ]);
  expect((await installationRows(db)).map((row) => [row.github_installation_id, row.deleted_at !== null])).toEqual([
    [11, false],
    [12, true],
  ]);
  expect((await repositoryRows(db)).map((row) => [row.github_repo_id, row.removed_at !== null])).toEqual([
    [100, false],
    [101, false],
    [200, true],
  ]);
  expect((await auditActions(db)).filter((action) => action === 'installation.deleted')).toHaveLength(1);
});

test('an installation already marked deleted is not asked about again', async () => {
  const { fake, sync } = await syncWorld();
  fake.addInstallation(remoteInstallation(12, OWNER));
  await sync.reconcileInstallations();
  fake.removeInstallation(id(12));
  await sync.reconcileInstallations();
  fake.calls.length = 0;
  expect(await sync.reconcileInstallations()).toEqual({ synced: 0, failed: 0 });
  expect(methods(fake.calls)).toEqual(['listInstallations']);
});

test('an account the operator newly allowed becomes admitted and synced, with its audit row', async () => {
  const world = await syncWorld();
  world.fake.addInstallation(remoteInstallation(12, 5000), remoteRepositories(200, 2));
  await world.sync.reconcileInstallations();
  expect(await repositoryRows(world.db)).toEqual([]);
  world.clock.advance(60_000);
  await world.syncFor([5000]).reconcileInstallations();
  expect((await installationRows(world.db))[0]).toMatchObject({
    admission_status: 'admitted',
    admission_reason: null,
    admission_decided_at: world.clock.now(),
  });
  expect(await repositoryRows(world.db)).toHaveLength(2);
  expect(await auditActions(world.db)).toEqual([
    'installation.rejected',
    'installation.admitted',
    'repository.added',
    'repository.added',
  ]);
});

test('an account no longer allowed becomes rejected with the reason policy_changed, and nothing is removed', async () => {
  const world = await syncWorld([5000]);
  world.fake.addInstallation(remoteInstallation(12, 5000), remoteRepositories(200, 2));
  await world.sync.reconcileInstallations();
  world.clock.advance(60_000);
  world.fake.calls.length = 0;
  expect(await world.syncFor([]).reconcileInstallations()).toEqual({ synced: 1, failed: 0 });
  expect((await installationRows(world.db))[0]).toMatchObject({
    admission_status: 'rejected',
    admission_reason: 'policy_changed',
    admission_decided_at: world.clock.now(),
  });
  expect((await repositoryRows(world.db)).map((row) => row.removed_at)).toEqual([null, null]);
  expect(methods(world.fake.calls)).toEqual(['listInstallations', 'getInstallation']);
  const rejected = (await auditRows(world.db)).at(-1);
  expect(rejected).toMatchObject({
    action: 'installation.rejected',
    metadata: { account_id: 5000, account_type: 'organization', reason_code: 'policy_changed' },
  });
});

test('an installation that fails is logged and counted, and the others are still synced', async () => {
  const { fake, sync, db, logs } = await syncWorld();
  fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 1));
  fake.addInstallation(remoteInstallation(12, OWNER), remoteRepositories(200, 1));
  fake.failNext('getInstallation', new GitHubUnavailableError());
  expect(await sync.reconcileInstallations()).toEqual({ synced: 1, failed: 1 });
  expect((await installationRows(db)).map((row) => row.github_installation_id)).toEqual([12]);
  const failure = logs.lines().find((line) => line['msg'] === 'installation.sync_failed');
  expect(failure).toMatchObject({ level: 40, githubInstallationId: 11 });
});

test.each([
  ['pagination_limit', new GitHubResponseError('GET /app/installations', ['pagination_limit'])],
  ['an unavailable GitHub', new GitHubUnavailableError()],
])(
  'a list of installations that cannot be read (%s) fails the run before anything is inferred',
  async (_label, error) => {
    const { fake, sync, db } = await syncWorld();
    fake.addInstallation(remoteInstallation(11, OWNER), remoteRepositories(100, 1));
    await sync.reconcileInstallations();
    const before = await stateOf(db);
    fake.removeInstallation(id(11));
    fake.failNext('listInstallations', error);
    await expect(sync.reconcileInstallations()).rejects.toBe(error);
    expect(await stateOf(db)).toEqual(before);
  },
);
