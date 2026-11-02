// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, type KyselyPlugin, SelectQueryNode } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { type DeliveryId, deliveryIdSchema } from '../domain/delivery-id.ts';
import type { Job } from '../domain/jobs.ts';
import {
  createJobsTable,
  deliveryRows,
  dropJobs,
  droppingEnqueuer,
  failingAfterSend,
  fakeEnqueuer,
  jobCount,
  sentJobs,
} from './jobs-fixture/test-support.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { countingDatabase } from './tenant-fixture/test-support.ts';
import { createWebhookDeliveries } from './webhook-deliveries.ts';
import { type DeliverySubject, markDeliveryProcessed } from './webhook-delivery-rows.ts';

// Recording a delivery and sending its job in one transaction (E06-S06), on PGlite with the fake enqueuer, which writes
// into a test table on the transaction it is given. The concurrent and the killed-connection cases need a real server
// and are in webhook-deliveries-concurrency.test.ts.

const ID_A = deliveryIdSchema.parse('5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c');
const ID_B = deliveryIdSchema.parse('0f1e2d3c-4b5a-4968-8776-655443322110');

/** A queue that holds a live job under every key: it sends nothing and answers `already_queued`. */
const aliveEnqueuer: JobEnqueuer = { enqueue: () => Promise.resolve('already_queued') };

const syncOf = (installation: number, deliveryId: DeliveryId): Job => ({
  type: 'sync-installation',
  githubInstallationId: parseGithubId(installation),
  deliveryId,
});

const subject = (
  deliveryId: DeliveryId,
  event = 'installation',
  action: string | null = 'created',
): DeliverySubject => ({
  deliveryId,
  event,
  action,
});

async function freshDatabase(): Promise<Kysely<Database>> {
  const { db } = await migratedTestDatabase();
  await createJobsTable(db);
  return db;
}

async function world() {
  const db = await freshDatabase();
  const enqueuer = fakeEnqueuer();
  return { db, enqueuer, deliveries: createWebhookDeliveries({ db, enqueuer }) };
}

async function processedAt(db: Kysely<Database>, deliveryId: DeliveryId): Promise<Date | null | undefined> {
  const row = await db
    .selectFrom('webhook_deliveries')
    .select('processed_at')
    .where('delivery_id', '=', deliveryId)
    .executeTakeFirst();
  return row?.processed_at;
}

test('a new delivery is recorded and its job sent under the delivery id, in one go: accepted', async () => {
  const { db, deliveries } = await world();
  expect(await deliveries.record(subject(ID_A, 'installation', 'created'), syncOf(31_001, ID_A))).toBe('accepted');
  const [row, ...others] = await deliveryRows(db);
  expect(others).toEqual([]);
  expect(row).toMatchObject({ delivery_id: ID_A, event: 'installation', action: 'created', processed_at: null });
  expect(row?.received_at).toBeInstanceOf(Date);
  expect(await sentJobs(db)).toEqual([{ idempotencyKey: ID_A, dedupeKey: null, job: syncOf(31_001, ID_A) }]);
});

test('the row holds the id, the event, the action and two times, and no payload', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  const [row] = await deliveryRows(db);
  expect(Object.keys(row ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'action',
    'delivery_id',
    'event',
    'processed_at',
    'received_at',
  ]);
});

test('an event with no action is recorded with a null action', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A, 'installation', null), syncOf(31_001, ID_A));
  expect((await deliveryRows(db)).map((row) => row.action)).toEqual([null]);
});

test('a delivery is sent with only its idempotency key: the delivery id, and no dedupe window', async () => {
  const { enqueuer, deliveries } = await world();
  const job = syncOf(31_001, ID_A);
  await deliveries.record(subject(ID_A), job);
  expect(enqueuer.calls).toEqual([{ job, options: { idempotencyKey: ID_A } }]);
});

test('a delivery whose job is still alive is a duplicate and stays unprocessed: the live job will finish it', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  expect(await processedAt(db, ID_A)).toBeNull();
  expect(await deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('duplicate');
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(await jobCount(db)).toBe(1);
  expect(await processedAt(db, ID_A)).toBeNull();
});

test('a redelivery while the first job was alive does not stop a later redelivery from requeuing once that job is lost', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  expect(await deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('duplicate');
  await dropJobs(db);
  expect(await deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('accepted');
  expect(await sentJobs(db)).toHaveLength(1);
  expect(await processedAt(db, ID_A)).toBeNull();
});

test('a delivery whose earlier job is gone (failed, dead-lettered, expired) is sent again under the same key: accepted', async () => {
  const { db, deliveries, enqueuer } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await dropJobs(db);
  expect(await deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('accepted');
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(await sentJobs(db)).toHaveLength(1);
  expect(enqueuer.calls.map((call) => call.options.idempotencyKey)).toEqual([ID_A, ID_A]);
  expect(await processedAt(db, ID_A)).toBeNull();
});

test('a delivery already processed is a duplicate: nothing is sent, and the row is left as it is', async () => {
  const { db, deliveries, enqueuer } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await deliveries.markDeliveryProcessed(ID_A);
  const [before] = await deliveryRows(db);
  expect(await deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('duplicate');
  expect(enqueuer.calls).toHaveLength(1);
  expect(await deliveryRows(db)).toEqual([before]);
});

test('a processed delivery is a duplicate even when its job is gone: it finished, so nothing is sent again', async () => {
  const { db, deliveries, enqueuer } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await deliveries.markDeliveryProcessed(ID_A);
  await dropJobs(db);
  expect(await deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('duplicate');
  expect(enqueuer.calls).toHaveLength(1);
  expect(await jobCount(db)).toBe(0);
});

test('a send that is deduplicated for a new delivery marks it processed in the same transaction: no job will ever do it', async () => {
  const db = await freshDatabase();
  const deliveries = createWebhookDeliveries({ db, enqueuer: droppingEnqueuer });
  expect(await deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('accepted');
  expect(await processedAt(db, ID_A)).toBeInstanceOf(Date);
  expect(await jobCount(db)).toBe(0);
});

test('a send that is deduplicated for a delivery recorded before leaves its row as it is, and is a duplicate', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await dropJobs(db);
  const [before] = await deliveryRows(db);
  const dropping = createWebhookDeliveries({ db, enqueuer: droppingEnqueuer });
  expect(await dropping.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('duplicate');
  expect(await deliveryRows(db)).toEqual([before]);
  expect(await jobCount(db)).toBe(0);
});

test('a send that is already queued for a new delivery leaves it unprocessed: the live job will finish it', async () => {
  const db = await freshDatabase();
  const deliveries = createWebhookDeliveries({ db, enqueuer: aliveEnqueuer });
  expect(await deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('accepted');
  expect(await processedAt(db, ID_A)).toBeNull();
  expect(await jobCount(db)).toBe(0);
});

test("a send that fails rolls the transaction back: no row and no job, and the error is the enqueuer's own", async () => {
  const db = await freshDatabase();
  const failure = new Error('the queue is down');
  const deliveries = createWebhookDeliveries({ db, enqueuer: failingAfterSend(fakeEnqueuer(), failure) });
  await expect(deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).rejects.toBe(failure);
  expect(await deliveryRows(db)).toEqual([]);
  expect(await jobCount(db)).toBe(0);
});

test('a redelivery after a failed send is recorded as new: GitHub can redeliver and it works', async () => {
  const db = await freshDatabase();
  const failing = createWebhookDeliveries({ db, enqueuer: failingAfterSend(fakeEnqueuer(), new Error('down')) });
  await expect(failing.record(subject(ID_A), syncOf(31_001, ID_A))).rejects.toThrow('down');
  const working = createWebhookDeliveries({ db, enqueuer: fakeEnqueuer() });
  expect(await working.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('accepted');
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(await jobCount(db)).toBe(1);
});

test('a send that fails for a delivery recorded before rolls back too: the row and the job it had are untouched', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  const [before] = await deliveryRows(db);
  const failing = createWebhookDeliveries({ db, enqueuer: failingAfterSend(fakeEnqueuer(), new Error('down')) });
  await expect(failing.record(subject(ID_A), syncOf(31_001, ID_A))).rejects.toThrow('down');
  expect(await deliveryRows(db)).toEqual([before]);
  expect(await jobCount(db)).toBe(1);
});

test('a delivery the database refuses is thrown and leaves nothing: no job is sent for a row that was not written', async () => {
  const { db, deliveries, enqueuer } = await world();
  // PostgreSQL's text cannot hold a NUL; the schemas of E06-S03 refuse one before it gets here.
  await expect(deliveries.record(subject(ID_A, 'bad\0event'), syncOf(31_001, ID_A))).rejects.toThrow();
  expect(enqueuer.calls).toEqual([]);
  expect(await deliveryRows(db)).toEqual([]);
});

test('two tenants take turns on nothing: their deliveries are two rows and two jobs, each with its own ids', async () => {
  const { db, deliveries } = await world();
  expect(await deliveries.record(subject(ID_A), syncOf(31_001, ID_A))).toBe('accepted');
  expect(await deliveries.record(subject(ID_B), syncOf(31_002, ID_B))).toBe('accepted');
  expect((await deliveryRows(db)).map((row) => row.delivery_id)).toHaveLength(2);
  expect(new Set((await deliveryRows(db)).map((row) => row.delivery_id))).toEqual(new Set([ID_A, ID_B]));
  expect(await sentJobs(db)).toEqual([
    { idempotencyKey: ID_A, dedupeKey: null, job: syncOf(31_001, ID_A) },
    { idempotencyKey: ID_B, dedupeKey: null, job: syncOf(31_002, ID_B) },
  ]);
});

test('finishing the delivery of one tenant leaves the delivery of another alone', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await deliveries.record(subject(ID_B), syncOf(31_002, ID_B));
  await deliveries.markDeliveryProcessed(ID_A);
  expect(await processedAt(db, ID_A)).toBeInstanceOf(Date);
  expect(await processedAt(db, ID_B)).toBeNull();
});

const LONG_AGO = new Date('2026-01-01T00:00:00Z');

async function setProcessedAt(db: Kysely<Database>, deliveryId: DeliveryId, at: Date | null): Promise<void> {
  await db.updateTable('webhook_deliveries').set({ processed_at: at }).where('delivery_id', '=', deliveryId).execute();
}

test('markDeliveryProcessed sets processed_at where it is null', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await markDeliveryProcessed(db, ID_A);
  const at = await processedAt(db, ID_A);
  expect(at).toBeInstanceOf(Date);
  expect(Math.abs((at?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
});

test('markDeliveryProcessed is idempotent: a delivery that is processed keeps the time it was processed at', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await setProcessedAt(db, ID_A, LONG_AGO);
  await markDeliveryProcessed(db, ID_A);
  await markDeliveryProcessed(db, ID_A);
  expect(await processedAt(db, ID_A)).toEqual(LONG_AGO);
});

test('markDeliveryProcessed matches the lower-case id the webhook wrote, whatever the case of the id it is given', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await markDeliveryProcessed(db, ID_A.toUpperCase());
  expect(await processedAt(db, ID_A)).toBeInstanceOf(Date);
});

test('markDeliveryProcessed of a delivery nobody recorded changes nothing and does not fail', async () => {
  const { db, deliveries } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await markDeliveryProcessed(db, ID_B);
  expect(await processedAt(db, ID_A)).toBeNull();
  expect(await deliveryRows(db)).toHaveLength(1);
});

test.each(["'; update webhook_deliveries set processed_at = now(); --", '', 'not-a-uuid'])(
  'markDeliveryProcessed refuses %j as a delivery id before it touches the database',
  async (id) => {
    const { db, deliveries } = await world();
    await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
    await expect(markDeliveryProcessed(db, id)).rejects.toThrow();
    expect(await processedAt(db, ID_A)).toBeNull();
  },
);

/** The kinds of the statements a block of work sends, in order. */
async function statementsOf(db: Kysely<Database>, work: (counted: Kysely<Database>) => Promise<unknown>) {
  const { db: counted, statements } = countingDatabase(db);
  await work(counted);
  return statements;
}

test('a new delivery costs two statements: the insert and the send', async () => {
  const { db, enqueuer } = await world();
  const statements = await statementsOf(db, (counted) =>
    createWebhookDeliveries({ db: counted, enqueuer }).record(subject(ID_A), syncOf(31_001, ID_A)),
  );
  expect(statements).toEqual(['InsertQueryNode', 'RawNode']);
});

test('a delivery recorded before costs three: the insert, the locking read and the send', async () => {
  const { db, deliveries, enqueuer } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  await dropJobs(db);
  const statements = await statementsOf(db, (counted) =>
    createWebhookDeliveries({ db: counted, enqueuer }).record(subject(ID_A), syncOf(31_001, ID_A)),
  );
  expect(statements).toEqual(['InsertQueryNode', 'SelectQueryNode', 'RawNode']);
});

/** The lock modifiers of the reads sent through the handle, as Kysely names them (`ForUpdate`). */
function watchLocks(db: Kysely<Database>): { readonly db: Kysely<Database>; readonly locks: string[] } {
  const locks: string[] = [];
  const plugin: KyselyPlugin = {
    transformQuery: ({ node }) => {
      if (SelectQueryNode.is(node)) {
        locks.push(...(node.endModifiers ?? []).map((modifier) => String(modifier.modifier)));
      }
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
  return { db: db.withPlugin(plugin), locks };
}

test('the read of a delivery recorded before locks its row, so two requests for one delivery take turns', async () => {
  const { db, deliveries, enqueuer } = await world();
  await deliveries.record(subject(ID_A), syncOf(31_001, ID_A));
  const watched = watchLocks(db);
  await createWebhookDeliveries({ db: watched.db, enqueuer }).record(subject(ID_A), syncOf(31_001, ID_A));
  expect(watched.locks).toEqual(['ForUpdate']);
});

test('a new delivery takes no lock of its own: the insert is what the others wait on', async () => {
  const { db, enqueuer } = await world();
  const watched = watchLocks(db);
  await createWebhookDeliveries({ db: watched.db, enqueuer }).record(subject(ID_A), syncOf(31_001, ID_A));
  expect(watched.locks).toEqual([]);
});
