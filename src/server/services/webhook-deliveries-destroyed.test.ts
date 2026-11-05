// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { deliveryIdSchema } from '../domain/delivery-id.ts';
import { createJobsTable, deliveryRows, fakeEnqueuer, jobCount } from './jobs-fixture/test-support.ts';
import { createWebhookDeliveries } from './webhook-deliveries.ts';

// A merge group taken down (E22-S01): the delivery is recorded and finished in one transaction, with no job, and the evaluation of
// that group gets its `destroyed_at` (the row is created when no job has yet, so a job that runs later writes nothing). The two
// tenants of the fixture each hold a group at the very same head SHA.

const ID_A = deliveryIdSchema.parse('5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c');
const ID_B = deliveryIdSchema.parse('0f1e2d3c-4b5a-4968-8776-655443322110');
const HEAD = '9'.repeat(40);
const BASE = '8'.repeat(40);

const subject = (deliveryId: typeof ID_A) => ({ deliveryId, event: 'merge_group', action: 'destroyed' });

async function world() {
  const { db } = await migratedTestDatabase();
  await createJobsTable(db);
  const tenants = await twoTenants(db);
  const enqueuer = fakeEnqueuer();
  const { t1, t2 } = tenants;
  const group = (tenant: typeof t1, headSha = HEAD) => ({
    githubInstallationId: tenant.githubInstallationId,
    githubRepoId: tenant.plain.githubRepoId,
    headSha,
    baseSha: BASE,
    deliveryId: ID_A,
  });
  return { db, t1, t2, enqueuer, group, deliveries: createWebhookDeliveries({ db, enqueuer }) };
}

const destroyedOf = async (db: Awaited<ReturnType<typeof world>>['db']) =>
  (
    await db.selectFrom('merge_group_evaluations').select(['installation_id', 'destroyed_at']).orderBy('id').execute()
  ).map((row) => [row.installation_id, row.destroyed_at instanceof Date] as const);

test('a group taken down is recorded and finished with no job, and the evaluation of the group is marked destroyed', async () => {
  const { db, t1, t2, enqueuer, group, deliveries } = await world();
  expect(await deliveries.recordDestroyed(subject(ID_A), group(t1))).toBe('accepted');
  expect(enqueuer.calls).toEqual([]);
  expect(await jobCount(db)).toBe(0);
  const [row, ...others] = await deliveryRows(db);
  expect(others).toEqual([]);
  expect(row).toMatchObject({ delivery_id: ID_A, event: 'merge_group', action: 'destroyed' });
  expect(row?.processed_at).toBeInstanceOf(Date);
  expect(await destroyedOf(db)).toEqual([
    [t1.installationId, true],
    [t2.installationId, false],
  ]);
});

test('the delivery of one tenant marks the group of that tenant only, though the other holds a group at the same head SHA', async () => {
  const { db, t1, t2, group, deliveries } = await world();
  await deliveries.recordDestroyed(subject(ID_A), group(t2));
  expect(await destroyedOf(db)).toEqual([
    [t1.installationId, false],
    [t2.installationId, true],
  ]);
});

test('a repository of the other tenant, named by the installation of this one, marks nothing', async () => {
  const { db, t1, t2, group, deliveries } = await world();
  await deliveries.recordDestroyed(subject(ID_A), { ...group(t1), githubRepoId: t2.plain.githubRepoId });
  expect(await destroyedOf(db)).toEqual([
    [t1.installationId, false],
    [t2.installationId, false],
  ]);
});

test('a group no job has met gets a tombstone row: the delivery is recorded and finished, and the row is destroyed with both SHAs', async () => {
  const { db, t1, group, deliveries } = await world();
  expect(await deliveries.recordDestroyed(subject(ID_A), group(t1, 'd'.repeat(40)))).toBe('accepted');
  expect((await deliveryRows(db)).map((row) => row.processed_at instanceof Date)).toEqual([true]);
  const rows = await db
    .selectFrom('merge_group_evaluations')
    .selectAll()
    .where('head_sha', '=', 'd'.repeat(40))
    .execute();
  expect(rows).toMatchObject([
    { installation_id: t1.installationId, base_sha: BASE, result: 'in_progress', check_run_id: null },
  ]);
  expect(rows[0]?.destroyed_at).toBeInstanceOf(Date);
  expect(await db.selectFrom('merge_group_evaluations').select('id').execute()).toHaveLength(3);
});

test('a group of a repository this instance does not hold gets no row: the delivery is still recorded and finished', async () => {
  const { db, t1, group, deliveries } = await world();
  expect(
    await deliveries.recordDestroyed(subject(ID_A), {
      ...group(t1, 'd'.repeat(40)),
      githubRepoId: parseGithubId(31_337),
    }),
  ).toBe('accepted');
  expect((await deliveryRows(db)).map((row) => row.processed_at instanceof Date)).toEqual([true]);
  expect(await db.selectFrom('merge_group_evaluations').select('id').execute()).toHaveLength(2);
});

test('a redelivery of a group taken down is a duplicate and changes nothing', async () => {
  const { db, t1, group, deliveries } = await world();
  await deliveries.recordDestroyed(subject(ID_A), group(t1));
  const before = await db.selectFrom('merge_group_evaluations').selectAll().orderBy('id').execute();
  expect(await deliveries.recordDestroyed(subject(ID_A), group(t1))).toBe('duplicate');
  expect(await db.selectFrom('merge_group_evaluations').selectAll().orderBy('id').execute()).toEqual(before);
  expect(await deliveryRows(db)).toHaveLength(1);
});

test('a second delivery of the same group under another id is recorded and keeps the first instant of the destruction', async () => {
  const { db, t1, group, deliveries } = await world();
  await deliveries.recordDestroyed(subject(ID_A), group(t1));
  const [first] = await db
    .selectFrom('merge_group_evaluations')
    .select('destroyed_at')
    .where('installation_id', '=', t1.installationId)
    .execute();
  expect(await deliveries.recordDestroyed(subject(ID_B), group(t1))).toBe('accepted');
  const [second] = await db
    .selectFrom('merge_group_evaluations')
    .select('destroyed_at')
    .where('installation_id', '=', t1.installationId)
    .execute();
  expect(second?.destroyed_at).toEqual(first?.destroyed_at);
  expect(await deliveryRows(db)).toHaveLength(2);
});

test('a failed statement rolls everything back: no delivery row, so a redelivery works', async () => {
  const { db, t1, group, deliveries } = await world();
  await db.schema.dropTable('merge_group_evaluations').cascade().execute();
  await expect(deliveries.recordDestroyed(subject(ID_A), group(t1))).rejects.toThrow();
  expect(await deliveryRows(db)).toEqual([]);
});

test('a signal that has aborted before the recording starts records nothing and marks nothing', async () => {
  const { db, t1, group, deliveries } = await world();
  const controller = new AbortController();
  controller.abort();
  await expect(deliveries.recordDestroyed(subject(ID_A), group(t1), controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(await deliveryRows(db)).toEqual([]);
  expect(await destroyedOf(db)).toEqual([
    [t1.installationId, false],
    [expect.any(Number), false],
  ]);
});

test('a deadline that passes after the tombstone is written rolls it back with the delivery', async () => {
  const { db, t1, group } = await world();
  const controller = new AbortController();
  const deliveries = createWebhookDeliveries({
    db: db.withPlugin({
      transformQuery: ({ node }) => {
        if (node.kind === 'InsertQueryNode' && node.into?.table.identifier.name === 'merge_group_evaluations') {
          queueMicrotask(() => {
            controller.abort();
          });
        }
        return node;
      },
      transformResult: ({ result }) => Promise.resolve(result),
    }),
    enqueuer: fakeEnqueuer(),
  });
  await expect(deliveries.recordDestroyed(subject(ID_A), group(t1), controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(await deliveryRows(db)).toEqual([]);
  expect((await destroyedOf(db)).map(([, destroyed]) => destroyed)).toEqual([false, false]);
});
