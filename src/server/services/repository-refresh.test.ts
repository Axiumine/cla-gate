// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { InstallationNotAdmittedError, type NotAdmittedReason } from './ports/github-errors.ts';
import { refreshRepositorySnapshot } from './repository-refresh.ts';
import {
  A_INSTALLATION,
  auditRows,
  OWNER,
  remoteInstallation,
  remoteRepositories,
  remoteRepository,
  repositoryRows,
  SHARED,
  stateOf,
  type TransferWorld,
  tenantData,
  transferWorld,
} from './sync-fixture/test-support.ts';
import { FakeGitHub } from './test-support.ts';

// The snapshot of one repository follows GitHub (E05-S09): a new name is stored, a repository GitHub no longer shows is
// marked removed, and a second call over the same state writes nothing.

const id = parseGithubId;
/** Typed as `unknown` so the matcher does not leak an `any` into the test. */
const anyDate: unknown = expect.any(Date);

/** On GitHub, tenant A's {@link SHARED} repository is called `fullName`; its other repositories are as they were. */
function nameShared(world: TransferWorld, fullName: string): void {
  world.fake.setRepositories(id(A_INSTALLATION), [...remoteRepositories(100, 2), remoteRepository(SHARED, fullName)]);
}

/** On GitHub, tenant A can no longer reach {@link SHARED}. */
function loseShared(world: TransferWorld): void {
  world.fake.setRepositories(id(A_INSTALLATION), remoteRepositories(100, 2));
}

const sharedRow = async (world: TransferWorld) =>
  (await repositoryRows(world.db)).find((row) => row.id === world.shared.repositoryId);

test.each([
  ['a rename', 'acme/renamed'],
  ['a rename together with a new owner', 'zeta/brand-new'],
])(
  '%s: the name is replaced, the row and everything on it stay, and the audit row holds ids only',
  async (_label, name) => {
    const world = await transferWorld();
    const before = await sharedRow(world);
    const data = await tenantData(world.db, world.shared.installationId);
    nameShared(world, name);
    world.clock.advance(60_000);
    const outcome = await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED));
    expect(outcome).toEqual({ status: 'renamed', changed: true });
    expect(await sharedRow(world)).toMatchObject({
      id: before?.id,
      full_name: name,
      enabled: true,
      cla_document_id: world.shared.documentId,
      removed_at: null,
      created_at: before?.created_at,
    });
    expect(await tenantData(world.db, world.shared.installationId)).toEqual(data);
    const evaluation = await world.db
      .selectFrom('pr_evaluations')
      .select(['repository_id', 'result', 'check_run_id'])
      .execute();
    expect(evaluation).toEqual([{ repository_id: world.shared.repositoryId, result: 'success', check_run_id: 555 }]);
    const renamed = (await auditRows(world.db)).filter((row) => row.action === 'repository.renamed');
    expect(renamed).toEqual([
      {
        installation_id: world.shared.installationId,
        actor_github_id: null,
        action: 'repository.renamed',
        subject_type: 'repository',
        subject_id: SHARED,
        metadata: {},
      },
    ]);
    expect(JSON.stringify(await auditRows(world.db))).not.toMatch(/zeta|renamed\/|brand-new/);
  },
);

test('a second call over the same state changes nothing: no row, no timestamp, no audit entry', async () => {
  const world = await transferWorld();
  nameShared(world, 'acme/renamed');
  await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED));
  const after = await stateOf(world.db);
  world.clock.advance(3_600_000);
  const again = await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED));
  expect(again).toEqual({ status: 'unchanged', changed: false });
  expect(await stateOf(world.db)).toEqual(after);
});

test('access lost: the repository is marked removed with its row, enforcement and document, and audited', async () => {
  const world = await transferWorld();
  const before = await sharedRow(world);
  loseShared(world);
  world.clock.advance(60_000);
  const outcome = await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED));
  expect(outcome).toEqual({ status: 'removed', changed: true });
  expect(await sharedRow(world)).toEqual({ ...before, removed_at: world.clock.now(), updated_at: anyDate });
  const removals = (await auditRows(world.db)).filter((row) => row.action === 'repository.removed');
  expect(removals.map((row) => [row.installation_id, row.subject_id, row.actor_github_id, row.metadata])).toEqual([
    [world.shared.installationId, SHARED, null, { reason_code: 'access_lost' }],
  ]);
  expect(await tenantData(world.db, world.shared.installationId)).toMatchObject({ documents: 1, signatures: 1 });
});

test('a second call after access was lost finds no active row and writes nothing', async () => {
  const world = await transferWorld();
  loseShared(world);
  await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED));
  const after = await stateOf(world.db);
  world.clock.advance(60_000);
  expect(await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED))).toEqual({
    status: 'not_stored',
    changed: false,
  });
  expect(await stateOf(world.db)).toEqual(after);
});

test('a removed repository that GitHub shows again stays removed until a sync lists it: a refresh never adds', async () => {
  const world = await transferWorld();
  loseShared(world);
  await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED));
  nameShared(world, 'acme/shared');
  const after = await stateOf(world.db);
  expect(await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED))).toEqual({
    status: 'not_stored',
    changed: false,
  });
  expect(await stateOf(world.db)).toEqual(after);
  await world.sync.syncInstallation(id(A_INSTALLATION));
  expect(await sharedRow(world)).toMatchObject({ removed_at: null, enabled: true });
});

test('a repository the installation reaches but no sync has stored is not added by a refresh', async () => {
  const world = await transferWorld();
  world.fake.setRepositories(id(A_INSTALLATION), [
    ...remoteRepositories(100, 2),
    remoteRepository(SHARED, 'acme/shared'),
    remoteRepository(777),
  ]);
  const before = await stateOf(world.db);
  expect(await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(777))).toEqual({
    status: 'not_stored',
    changed: false,
  });
  expect(await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(999))).toEqual({
    status: 'not_stored',
    changed: false,
  });
  expect(await stateOf(world.db)).toEqual(before);
});

test('GitHub is asked for the repository by the installation that owns the row, with ids only', async () => {
  const world = await transferWorld();
  await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED));
  expect(world.fake.calls.at(-1)).toEqual({ method: 'getRepositoryById', installationId: id(A_INSTALLATION) });
});

// -------------------------------------------------------------------------------------- tenants that are closed

const CLOSED: readonly (readonly [NotAdmittedReason, Record<string, unknown>])[] = [
  ['rejected', { admission_status: 'rejected', admission_reason: 'policy_changed' }],
  ['deleted', { deleted_at: new Date('2026-11-02T10:00:00Z') }],
  ['suspended', { suspended_at: new Date('2026-11-02T10:00:00Z') }],
];

test.each(CLOSED)('a %s installation is refused before any request and nothing is written', async (reason, columns) => {
  const world = await transferWorld();
  await world.db
    .updateTable('installations')
    .set(columns)
    .where('github_installation_id', '=', A_INSTALLATION)
    .execute();
  nameShared(world, 'acme/renamed');
  const before = await stateOf(world.db);
  await expect(world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED))).rejects.toEqual(
    new InstallationNotAdmittedError(reason),
  );
  expect(world.fake.calls.filter((call) => call.method === 'getRepositoryById')).toEqual([]);
  expect(await stateOf(world.db)).toEqual(before);
});

test('an installation the instance has never stored is refused as unknown', async () => {
  const world = await transferWorld();
  await expect(world.sync.refreshRepositorySnapshot(id(99), id(SHARED))).rejects.toEqual(
    new InstallationNotAdmittedError('unknown'),
  );
});

test.each(CLOSED)(
  'a %s installation that closed while GitHub was asked gets nothing written',
  async (_reason, columns) => {
    const world = await transferWorld();
    nameShared(world, 'acme/renamed');
    world.fake.beforeNext('getRepositoryById', async () => {
      await world.db
        .updateTable('installations')
        .set(columns)
        .where('github_installation_id', '=', A_INSTALLATION)
        .execute();
    });
    const before = (await repositoryRows(world.db)).filter(
      (row) => row.installation_id === world.shared.installationId,
    );
    const outcome = await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(SHARED));
    expect(outcome).toEqual({ status: 'not_served', changed: false });
    expect(
      (await repositoryRows(world.db)).filter((row) => row.installation_id === world.shared.installationId),
    ).toEqual(before);
  },
);

test('an installation with no stored row, behind a client with no gate, gets nothing written', async () => {
  const world = await transferWorld();
  const fake = new FakeGitHub();
  fake.addInstallation(remoteInstallation(99, OWNER), [remoteRepository(SHARED, 'acme/renamed')]);
  const before = await stateOf(world.db);
  const outcome = await refreshRepositorySnapshot(
    { db: world.db, github: fake, clock: world.clock },
    id(99),
    id(SHARED),
  );
  expect(outcome).toEqual({ status: 'not_served', changed: false });
  expect(await stateOf(world.db)).toEqual(before);
});

// ------------------------------------------------------------------------------------------------- cross-tenant

test('a refresh for A never reads, renames or removes a repository of B', async () => {
  const world = await transferWorld();
  const before = await stateOf(world.db);
  const calls = world.fake.calls.length;
  // A's listing does not show B's repository 200: GitHub answers 404 for it under A's token.
  expect(await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(200))).toEqual({
    status: 'not_stored',
    changed: false,
  });
  // Even a GitHub that showed B's repository under A, with another name, changes B's row in no way.
  world.fake.setRepositories(id(A_INSTALLATION), [remoteRepository(200, 'acme/taken-over')]);
  expect(await world.sync.refreshRepositorySnapshot(id(A_INSTALLATION), id(200))).toEqual({
    status: 'not_stored',
    changed: false,
  });
  expect(await stateOf(world.db)).toEqual(before);
  expect(world.fake.calls.slice(calls).map((call) => call.installationId)).toEqual([
    id(A_INSTALLATION),
    id(A_INSTALLATION),
  ]);
});
