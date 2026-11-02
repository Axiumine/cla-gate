// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterAll, expect, test } from 'vitest';
import { buildApp } from '../../app.ts';
import { clearRecords, createJobsTable, dropJobs, fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { countingDatabase, tenantDatabase } from '../../services/tenant-fixture/test-support.ts';
import { markDeliveryProcessed } from '../../services/webhook-delivery-rows.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { FIXTURE_IDS } from '../github/webhook-fixture/test-support.ts';
import { createLogger } from './logger.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT } from './test-support.ts';
import {
  deliveryIdOf,
  deliveryOf,
  OPENED_PULL_REQUEST,
  ROUTING_ROWS,
  SQL,
} from './webhook-table-fixture/test-support.ts';

// What the request path costs the database (E06-S07): at most 5 statements per delivery (the installation lookup, the
// repository lookup, the insert, the select for update and the send), counted by a Kysely plugin on every statement,
// the ones inside the transaction and the ones the fake queue sends on it included.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const MOST_STATEMENTS = 5;

async function start() {
  const db = await tenantDatabase();
  await createJobsTable(db);
  const counted = countingDatabase(db);
  const enqueuer = fakeEnqueuer();
  const config = testConfig(ENV);
  const app = await buildApp({
    config,
    db: counted.db,
    logger: createLogger(config, captureLogs().destination),
    enqueuer,
  });
  return { app, db, enqueuer, statements: counted.statements };
}

// One app and one database serve the file; every test starts from no delivery, no job and no counted statement.
let started: ReturnType<typeof start> | undefined;
afterAll(async () => {
  await (await started)?.app.close();
});

async function running() {
  started ??= start();
  const server = await started;
  await clearRecords(server.db);
  server.statements.length = 0;
  return server;
}

test.each(ROUTING_ROWS.map((row, index) => [row.label, row, index] as const))(
  '%s: the statements are the expected ones and are at most 5',
  async (_label, row, index) => {
    const { app, statements } = await running();
    const { body, headers } = deliveryOf(row, index);
    const response = await postDelivery(app, body, headers);
    expect(response.statusCode).toBe(row.status);
    expect(response.json()).toEqual(row.answer);
    expect(statements).toEqual(row.statements);
    expect(statements.length).toBeLessThanOrEqual(MOST_STATEMENTS);
  },
);

/** Delivers the ordinary accepted delivery of the table, as delivery 0. */
async function deliverFirst(app: Awaited<ReturnType<typeof running>>['app']) {
  const { body, headers } = deliveryOf(OPENED_PULL_REQUEST, 0);
  return postDelivery(app, body, headers);
}

test('a delivery recorded and finished before costs four statements, the last of them the select for update, and sends nothing', async () => {
  const { app, db, statements, enqueuer } = await running();
  await deliverFirst(app);
  await markDeliveryProcessed(db, deliveryIdOf(0));
  statements.length = 0;
  enqueuer.calls.length = 0;
  const response = await deliverFirst(app);
  expect([response.statusCode, response.json()]).toEqual([200, { status: 'duplicate' }]);
  expect(statements).toEqual([SQL.select, SQL.select, SQL.insert, SQL.select]);
  expect(enqueuer.calls).toEqual([]);
});

test('a redelivery whose job was lost is the most a delivery costs: five statements', async () => {
  const { app, db, statements } = await running();
  await deliverFirst(app);
  await dropJobs(db);
  statements.length = 0;
  const response = await deliverFirst(app);
  expect([response.statusCode, response.json()]).toEqual([202, { status: 'accepted' }]);
  expect(statements).toEqual([SQL.select, SQL.select, SQL.insert, SQL.select, SQL.enqueue]);
  expect(statements).toHaveLength(MOST_STATEMENTS);
});

test('a delivery that is refused before the routing, or answered at once, sends no statement at all', async () => {
  const { app, statements } = await running();
  const body = '{"zen":"x"}';
  const unsigned = await postDelivery(app, body, { 'content-type': 'application/json' });
  const ping = await postDelivery(app, body, deliveryHeaders(body));
  const malformed = await postDelivery(app, '{"a":', deliveryHeaders('{"a":'));
  expect([unsigned.statusCode, ping.statusCode, malformed.statusCode]).toEqual([401, 200, 400]);
  expect(statements).toEqual([]);
});
