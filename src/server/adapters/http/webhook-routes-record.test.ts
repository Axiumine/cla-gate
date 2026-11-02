// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterAll, expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { deliveryIdSchema } from '../../domain/delivery-id.ts';
import { clearRecords, deliveryRows, dropJobs, jobCount, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { markDeliveryProcessed } from '../../services/webhook-delivery-rows.ts';
import { FIXTURE_IDS, type WebhookEvent, webhookFixture, withValue } from '../github/webhook-fixture/test-support.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, sharedTenantWebhookApp } from './test-support.ts';

// Recording the delivery and sending its job (E06-S06), over the real route and the fake enqueuer: what a delivery of
// each event leaves behind, and what a repeat of it is answered with.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const ID = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';

type Running = Awaited<ReturnType<typeof sharedTenantWebhookApp>>;

// One app and one database serve the file (a database costs seconds to build); every test starts from no delivery, no job
// and no call to the enqueuer.
let started: Promise<Running> | undefined;
afterAll(async () => {
  await (await started)?.app.close();
});

async function running(): Promise<Running> {
  started ??= sharedTenantWebhookApp(ENV);
  const server = await started;
  await clearRecords(server.db);
  server.enqueuer.calls.length = 0;
  return server;
}

/** A signed delivery of `event` under the delivery id `id`. */
function deliver(app: Running['app'], event: string, body: unknown, id = ID) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return postDelivery(
    app,
    text,
    deliveryHeaders(text, { headers: { 'x-github-event': event, 'x-github-delivery': id } }),
  );
}

const ACCEPTED = { status: 'accepted' };

const JOB_OF: readonly (readonly [WebhookEvent, string, string])[] = [
  ['pull_request', 'opened', 'evaluate-pr'],
  ['check_run', 'rerequested', 'evaluate-head-sha'],
  ['check_suite', 'rerequested', 'evaluate-head-sha'],
  ['issue_comment', 'created', 'recheck-comment'],
  ['installation', 'created', 'sync-installation'],
  ['installation_repositories', 'added', 'sync-installation'],
  ['github_app_authorization', 'revoked', 'revoke-user-sessions'],
];

test.each(JOB_OF)(
  'a %s %s delivery is recorded once and starts one %s job under its delivery id',
  async (event, action, type) => {
    const { app, db } = await running();
    const response = await deliver(app, event, webhookFixture(event));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(ACCEPTED);
    const rows = await deliveryRows(db);
    expect(rows).toMatchObject([{ delivery_id: ID, event, action, processed_at: null }]);
    const jobs = await sentJobs(db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ idempotencyKey: ID, job: { type, deliveryId: ID } });
  },
);

test('the same delivery again is a 200 duplicate: still one row and one job', async () => {
  const { app, db } = await running();
  expect((await deliver(app, 'pull_request', webhookFixture('pull_request'))).statusCode).toBe(202);
  const again = await deliver(app, 'pull_request', webhookFixture('pull_request'));
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual({ status: 'duplicate' });
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(await jobCount(db)).toBe(1);
});

test('a redelivery whose delivery id differs only in case is the same delivery', async () => {
  const { app, db } = await running();
  await deliver(app, 'pull_request', webhookFixture('pull_request'), ID);
  const again = await deliver(app, 'pull_request', webhookFixture('pull_request'), ID.toUpperCase());
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual({ status: 'duplicate' });
  expect((await deliveryRows(db)).map((row) => row.delivery_id)).toEqual([ID]);
});

test('a delivery whose job was lost before it finished is sent again by a redelivery: accepted, one live job', async () => {
  const { app, db, enqueuer } = await running();
  await deliver(app, 'pull_request', webhookFixture('pull_request'));
  await dropJobs(db);
  const again = await deliver(app, 'pull_request', webhookFixture('pull_request'));
  expect(again.statusCode).toBe(202);
  expect(again.json()).toEqual(ACCEPTED);
  expect(await deliveryRows(db)).toHaveLength(1);
  expect(await jobCount(db)).toBe(1);
  expect(enqueuer.calls.map((call) => call.options.idempotencyKey)).toEqual([ID, ID]);
});

test('a delivery whose job finished is a 200 duplicate, and nothing is sent', async () => {
  const { app, db, enqueuer } = await running();
  await deliver(app, 'pull_request', webhookFixture('pull_request'));
  await markDeliveryProcessed(db, ID);
  await dropJobs(db);
  const again = await deliver(app, 'pull_request', webhookFixture('pull_request'));
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual({ status: 'duplicate' });
  expect(enqueuer.calls).toHaveLength(1);
  expect(await jobCount(db)).toBe(0);
});

test('the recording keeps the id, the event and the action and nothing of the payload', async () => {
  const { app, db } = await running();
  const canary = 'canary-value-8e1f5b2a';
  const payload = withValue(
    withValue(webhookFixture('pull_request'), 'pull_request.title', canary),
    'repository.full_name',
    `${canary}/${canary}`,
  );
  await deliver(app, 'pull_request', payload);
  const comment = withValue(webhookFixture('issue_comment'), 'comment.body', `/recheck\n${canary}`);
  await deliver(app, 'issue_comment', comment, '0f1e2d3c-4b5a-4968-8776-655443322110');
  const stored = JSON.stringify([await deliveryRows(db), await sentJobs(db)]);
  expect(stored).not.toContain(canary);
  expect(stored).not.toContain('fixture-');
  expect(await deliveryRows(db)).toHaveLength(2);
});

test('a delivery id that is not a UUID is a 400 and records nothing, whatever it holds', async () => {
  const { app, db } = await running();
  const hostile = "5b8f2c1e'; drop table webhook_deliveries; --";
  const response = await deliver(app, 'pull_request', webhookFixture('pull_request'), hostile);
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_header_invalid');
  expect(await deliveryRows(db)).toEqual([]);
  expect(await jobCount(db)).toBe(0);
});

test('the id of a stored delivery is the parsed id: a UUID in upper case is stored in lower case', async () => {
  const { app, db } = await running();
  await deliver(app, 'installation', webhookFixture('installation'), ID.toUpperCase());
  expect((await deliveryRows(db)).map((row) => row.delivery_id)).toEqual([deliveryIdSchema.parse(ID)]);
});
