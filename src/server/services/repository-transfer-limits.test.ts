// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { isDeepStrictEqual } from 'node:util';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { evaluationEligibility } from '../domain/eligibility.ts';
import type { InstallationSync } from './installation-sync.ts';
import { findActiveRepositoryByGithubId, markRepositoriesRemoved } from './repository-queries.ts';
import { releaseTransferred } from './repository-transfer.ts';
import {
  A_INSTALLATION,
  auditRows,
  B_INSTALLATION,
  moveShared,
  remoteInstallation,
  remoteRepositories,
  remoteRepository,
  repositoryRows,
  rowIdOf,
  SHARED,
  type TransferWorld,
  tenantData,
  transferWorld,
} from './sync-fixture/test-support.ts';

// What may and may not trigger the release of another tenant's repository (E05-S09), and the same repository leaving a
// tenant and coming back to it.

const id = parseGithubId;
const STRANGER_ACCOUNT = 5001;
const STRANGER_INSTALLATION = 13;
const EARLIER = new Date('2026-06-01T12:00:00Z');
const LATER = new Date('2026-11-03T08:00:00Z');

const sharedRowOfA = async (world: TransferWorld) =>
  (await repositoryRows(world.db)).find((row) => row.id === world.shared.repositoryId);

/** Tenant B's list names the repository, but B is in a state in which the instance does not serve it. */
const CLOSED_B: readonly (readonly [label: string, close: (world: TransferWorld) => InstallationSync])[] = [
  [
    'suspended',
    (world) => {
      world.fake.suspend(id(B_INSTALLATION), EARLIER);
      return world.sync;
    },
  ],
  [
    'uninstalled',
    (world) => {
      world.fake.removeInstallation(id(B_INSTALLATION));
      return world.sync;
    },
  ],
  ['rejected by a changed policy', (world) => world.syncFor([])],
];

test.each(CLOSED_B)(
  'a repository in the list of a %s installation releases nothing of another tenant',
  async (_label, close) => {
    const world = await transferWorld();
    moveShared(world);
    const before = await repositoryRows(world.db);
    const auditBefore = (await auditRows(world.db)).filter(
      (row) => row.installation_id === world.shared.installationId,
    );
    const outcome = await close(world).syncInstallation(id(B_INSTALLATION));
    expect(outcome.repositories.added).toBe(0);
    expect((await sharedRowOfA(world))?.removed_at).toBeNull();
    expect(
      (await repositoryRows(world.db)).filter((row) => row.installation_id === world.shared.installationId),
    ).toEqual(before.filter((row) => row.installation_id === world.shared.installationId));
    expect((await auditRows(world.db)).filter((row) => row.installation_id === world.shared.installationId)).toEqual(
      auditBefore,
    );
  },
);

test('a sync of B that does not list the repository leaves the active row of A alone', async () => {
  const world = await transferWorld();
  const before = await repositoryRows(world.db);
  expect(await world.sync.syncInstallation(id(B_INSTALLATION))).toMatchObject({ status: 'synced', changed: false });
  expect(await repositoryRows(world.db)).toEqual(before);
});

test.each([
  ['A syncs before the stranger', [A_INSTALLATION, STRANGER_INSTALLATION]],
  ['the stranger syncs before A', [STRANGER_INSTALLATION, A_INSTALLATION]],
] as const)(
  'a transfer to a rejected account (%s) leaves the repository removed under A and synced nowhere else',
  async (_label, order) => {
    const world = await transferWorld();
    world.fake.setRepositories(id(A_INSTALLATION), remoteRepositories(100, 2));
    world.fake.addInstallation(remoteInstallation(STRANGER_INSTALLATION, STRANGER_ACCOUNT), [
      remoteRepository(SHARED, 'stranger/shared'),
    ]);
    for (const installation of order) {
      await world.sync.syncInstallation(id(installation));
    }
    const stranger = await rowIdOf(world.db, STRANGER_INSTALLATION);
    const rows = (await repositoryRows(world.db)).filter((row) => row.github_repo_id === SHARED);
    expect(rows.map((row) => [row.installation_id, row.removed_at !== null])).toEqual([
      [world.shared.installationId, true],
    ]);
    expect((await repositoryRows(world.db)).filter((row) => row.installation_id === stranger)).toEqual([]);
    expect(world.fake.calls.filter((call) => call.installationId === id(STRANGER_INSTALLATION))).toEqual([
      { method: 'getInstallation', installationId: id(STRANGER_INSTALLATION) },
    ]);
    expect(await findActiveRepositoryByGithubId(world.db, world.shared.installationId, id(SHARED))).toBeNull();
    expect(await findActiveRepositoryByGithubId(world.db, stranger, id(SHARED))).toBeNull();
    const removed = rows[0];
    expect(
      evaluationEligibility(
        { admissionStatus: 'admitted', deletedAt: null, suspendedAt: null },
        { removedAt: removed?.removed_at ?? null, enabled: removed?.enabled ?? false },
      ),
    ).toEqual({ eligible: false, reason: 'repository_removed' });
    expect(await tenantData(world.db, world.shared.installationId)).toMatchObject({ documents: 1, signatures: 1 });
  },
);

test('releaseTransferred releases the listed ids that another installation holds, and nothing else', async () => {
  const world = await transferWorld();
  const aId = world.shared.installationId;
  await markRepositoriesRemoved(world.db, aId, [id(101)], EARLIER);
  const before = await repositoryRows(world.db);
  await world.db
    .transaction()
    .execute((trx) => releaseTransferred(trx, world.bId, [id(SHARED), id(101), id(200), id(999)], LATER));
  const changed = (await repositoryRows(world.db)).filter((row) => !before.some((old) => isDeepStrictEqual(old, row)));
  expect(changed.map((row) => [row.installation_id, row.github_repo_id, row.removed_at])).toEqual([
    [aId, SHARED, LATER],
  ]);
  const removals = (await auditRows(world.db)).filter((row) => row.action === 'repository.removed');
  expect(removals.map((row) => [row.installation_id, row.subject_id, row.metadata])).toEqual([
    [aId, SHARED, { reason_code: 'transferred' }],
  ]);
});

test('releaseTransferred never releases a row of the installation it is called for', async () => {
  const world = await transferWorld();
  const before = await repositoryRows(world.db);
  const auditBefore = await auditRows(world.db);
  await world.db
    .transaction()
    .execute((trx) => releaseTransferred(trx, world.shared.installationId, [id(SHARED), id(100), id(101)], LATER));
  expect(await repositoryRows(world.db)).toEqual(before);
  expect(await auditRows(world.db)).toEqual(auditBefore);
});

test('releaseTransferred with no ids runs no statement and writes nothing', async () => {
  const world = await transferWorld();
  const before = await repositoryRows(world.db);
  await world.db.transaction().execute((trx) => releaseTransferred(trx, world.bId, [], LATER));
  expect(await repositoryRows(world.db)).toEqual(before);
});

test('a repository that leaves a tenant and is listed again under it keeps its row, enforcement and document', async () => {
  const world = await transferWorld();
  const aId = world.shared.installationId;
  const before = await tenantData(world.db, aId);
  world.fake.setRepositories(id(A_INSTALLATION), remoteRepositories(100, 2));
  await world.sync.syncInstallation(id(A_INSTALLATION));
  expect((await sharedRowOfA(world))?.removed_at).not.toBeNull();
  world.clock.advance(60_000);
  world.fake.setRepositories(id(A_INSTALLATION), [
    ...remoteRepositories(100, 2),
    remoteRepository(SHARED, 'acme/shared'),
  ]);
  await world.sync.syncInstallation(id(A_INSTALLATION));
  expect(await sharedRowOfA(world)).toMatchObject({
    id: world.shared.repositoryId,
    removed_at: null,
    enabled: true,
    cla_document_id: world.shared.documentId,
    full_name: 'acme/shared',
  });
  expect(await tenantData(world.db, aId)).toEqual(before);
  const trail = (await auditRows(world.db)).filter((row) => row.subject_id === SHARED);
  expect(trail.map((row) => [row.action, row.metadata])).toEqual([
    ['repository.added', {}],
    ['repository.removed', { reason_code: 'not_listed' }],
    ['repository.added', {}],
  ]);
});

test('a reconciliation of all installations moves the repository whichever installation GitHub lists first', async () => {
  const world = await transferWorld();
  moveShared(world);
  await world.sync.reconcileInstallations();
  const active = (await repositoryRows(world.db)).filter(
    (row) => row.github_repo_id === SHARED && row.removed_at === null,
  );
  expect(active.map((row) => row.installation_id)).toEqual([world.bId]);
  expect(await tenantData(world.db, world.shared.installationId)).toMatchObject({ documents: 1, signatures: 1 });
});
