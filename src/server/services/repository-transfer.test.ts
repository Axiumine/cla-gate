// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createInstallationSync } from './installation-sync.ts';
import { findActiveRepositoryByGithubId } from './repository-queries.ts';
import {
  A_INSTALLATION,
  auditRows,
  B_INSTALLATION,
  failRepositoryInsert,
  moveShared,
  repositoryRows,
  SHARED,
  tenantData,
  transferWorld,
} from './sync-fixture/test-support.ts';

// A repository moves from one tenant of this server to another (E05-S09). Whichever tenant syncs first, the old tenant
// keeps its row, documents and signatures, the new tenant gets a new row with nothing attached, and a GitHub repository
// is active under one installation at the end.

const id = parseGithubId;

/** Both orders in which the two tenants can sync after the move, and why the old tenant's row ends up removed. */
const ORDERS = [
  ['A syncs before B', [A_INSTALLATION, B_INSTALLATION], 'not_listed'],
  ['B syncs before A', [B_INSTALLATION, A_INSTALLATION], 'transferred'],
] as const;

/** The world after the repository moved on GitHub and the two tenants synced in `order`, a minute apart. */
async function afterTransfer(order: readonly number[]) {
  const world = await transferWorld();
  const aId = world.shared.installationId;
  const before = { data: await tenantData(world.db, aId), rows: await repositoryRows(world.db) };
  moveShared(world);
  for (const installation of order) {
    world.clock.advance(60_000);
    await world.sync.syncInstallation(id(installation));
  }
  const shared = (await repositoryRows(world.db)).filter((row) => row.github_repo_id === SHARED);
  return { world, before, aId, rowOfA: shared.find((row) => row.installation_id === aId), shared };
}

test.each(ORDERS)(
  'transfer, %s: A keeps its row and what hangs on it, B gets a new disabled row',
  async (_label, order) => {
    const { world, before, aId, rowOfA, shared } = await afterTransfer(order);
    const rowOfB = shared.find((row) => row.installation_id === world.bId);
    expect(shared).toHaveLength(2);
    expect(rowOfA).toMatchObject({
      id: world.shared.repositoryId,
      full_name: 'acme/shared',
      enabled: true,
      cla_document_id: world.shared.documentId,
    });
    expect(rowOfA?.removed_at).not.toBeNull();
    expect(rowOfB).toMatchObject({
      full_name: 'newowner/shared',
      enabled: false,
      cla_document_id: null,
      removed_at: null,
    });
    expect(rowOfB?.id).not.toBe(rowOfA?.id);
    expect(await tenantData(world.db, aId)).toEqual(before.data);
  },
);

test.each(ORDERS)(
  'transfer, %s: B sees no document, allowlist entry, override, signature or evaluation of A',
  async (_label, order) => {
    const { world } = await afterTransfer(order);
    expect(await tenantData(world.db, world.bId)).toEqual({
      documents: 0,
      signatures: 0,
      allowlist: 0,
      overrides: 0,
      evaluations: 0,
    });
    const signatures = await world.db.selectFrom('signatures').select('installation_id').execute();
    expect(signatures.map((row) => row.installation_id)).toEqual([world.shared.installationId]);
  },
);

test.each(ORDERS)(
  'transfer, %s: the lookup finds B for B, nothing for A, and one active row in all',
  async (_label, order) => {
    const { world, aId } = await afterTransfer(order);
    expect(await findActiveRepositoryByGithubId(world.db, aId, id(SHARED))).toBeNull();
    expect(await findActiveRepositoryByGithubId(world.db, world.bId, id(SHARED))).toMatchObject({
      installation_id: world.bId,
      full_name: 'newowner/shared',
    });
    const active = (await repositoryRows(world.db)).filter((row) => row.github_repo_id === SHARED && !row.removed_at);
    expect(active.map((row) => row.installation_id)).toEqual([world.bId]);
  },
);

test.each(ORDERS)(
  "transfer, %s: A's removal says why, B's addition follows, and no name is recorded",
  async (_label, order, reason) => {
    const { world, aId } = await afterTransfer(order);
    const rows = (await auditRows(world.db)).filter((row) => row.subject_id === SHARED);
    expect(rows.map((row) => [row.installation_id, row.action, row.metadata])).toEqual([
      [aId, 'repository.added', {}],
      [aId, 'repository.removed', { reason_code: reason }],
      [world.bId, 'repository.added', {}],
    ]);
    expect(rows.map((row) => [row.actor_github_id, row.subject_type])).toEqual(Array(3).fill([null, 'repository']));
    expect(JSON.stringify(rows)).not.toMatch(/shared/);
  },
);

test("B syncing first marks A's row removed and changes no other column of it, not even updated_at", async () => {
  const world = await transferWorld();
  const before = (await repositoryRows(world.db)).find((row) => row.id === world.shared.repositoryId);
  moveShared(world);
  world.clock.advance(60_000);
  await world.sync.syncInstallation(id(B_INSTALLATION));
  const after = (await repositoryRows(world.db)).find((row) => row.id === world.shared.repositoryId);
  expect(before?.removed_at).toBeNull();
  expect(after).toEqual({ ...before, removed_at: world.clock.now() });
});

test('A syncing second finds the row already released: it writes no second removal', async () => {
  const world = await transferWorld();
  moveShared(world);
  await world.sync.syncInstallation(id(B_INSTALLATION));
  const aId = world.shared.installationId;
  const removals = async () =>
    (await auditRows(world.db)).filter((row) => row.installation_id === aId && row.action === 'repository.removed');
  expect(await removals()).toHaveLength(1);
  expect(await world.sync.syncInstallation(id(A_INSTALLATION))).toMatchObject({ status: 'synced', changed: false });
  expect(await removals()).toHaveLength(1);
});

test("the release is undone with the rest when B's write fails: A's row stays active and nothing is audited", async () => {
  const world = await transferWorld();
  const failing = createInstallationSync({
    db: world.db.withPlugin(failRepositoryInsert(1)),
    github: world.fake,
    admission: world.admissionFor([5000]),
    clock: world.clock,
    logger: world.logger,
  });
  moveShared(world);
  await expect(failing.syncInstallation(id(B_INSTALLATION))).rejects.toThrow('disk full');
  const rowOfA = (await repositoryRows(world.db)).find((row) => row.id === world.shared.repositoryId);
  expect(rowOfA?.removed_at).toBeNull();
  expect((await auditRows(world.db)).filter((row) => row.action === 'repository.removed')).toEqual([]);
  expect(await world.sync.syncInstallation(id(B_INSTALLATION))).toMatchObject({ status: 'synced', changed: true });
  expect(await findActiveRepositoryByGithubId(world.db, world.shared.installationId, id(SHARED))).toBeNull();
});
