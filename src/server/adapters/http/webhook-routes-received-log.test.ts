// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterAll, expect, test, vi } from 'vitest';
import { clearRecords } from '../../services/jobs-fixture/test-support.ts';
import { FIXTURE_IDS, sorted, webhookFixture, withValue } from '../github/webhook-fixture/test-support.ts';
import { webhookDeliverySchema } from '../github/webhook-schemas.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, sharedTenantWebhookApp, sign } from './test-support.ts';
import { deliveryIdOf, deliveryOf, ROUTING_ROWS } from './webhook-table-fixture/test-support.ts';

// The line every delivery gets (E06-S07): `webhook.received` with the event, the action, the delivery id, the numeric
// installation id, the outcome, the reason and the duration, one per delivery whatever became of it.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const ID = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';

type Running = Awaited<ReturnType<typeof sharedTenantWebhookApp>>;

let started: Promise<Running> | undefined;
afterAll(async () => {
  await (await started)?.app.close();
});

async function running(): Promise<Running> {
  started ??= sharedTenantWebhookApp(ENV);
  const server = await started;
  server.failSends(undefined);
  await clearRecords(server.db);
  server.enqueuer.calls.length = 0;
  return server;
}

/** The `webhook.received` lines written since `since` lines were written. */
function receivedSince(logs: Running['logs'], since: number) {
  return logs
    .lines()
    .slice(since)
    .filter((line) => line['msg'] === 'webhook.received');
}

/** Sends a signed delivery and returns the one `webhook.received` line it produced, after checking there was exactly one. */
async function deliverAndRead(server: Running, event: string, body: unknown, id = ID) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const before = server.logs.lines().length;
  const response = await postDelivery(
    server.app,
    text,
    deliveryHeaders(text, { headers: { 'x-github-event': event, 'x-github-delivery': id } }),
  );
  const lines = receivedSince(server.logs, before);
  expect(lines).toHaveLength(1);
  return { response, line: lines[0] };
}

test.each(ROUTING_ROWS.map((row, index) => [row.label, row, index] as const))(
  '%s: one line with its event, action, ids, outcome and reason',
  async (_label, row, index) => {
    const server = await running();
    const { body, headers } = deliveryOf(row, index);
    const before = server.logs.lines().length;
    await postDelivery(server.app, body, headers);
    const lines = receivedSince(server.logs, before);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 30,
      msg: 'webhook.received',
      event: row.event,
      deliveryId: deliveryIdOf(index),
      ...row.received,
    });
    expect(sorted(Object.keys(lines[0] ?? {}))).toEqual(
      sorted([
        'action',
        'deliveryId',
        'durationMs',
        'event',
        'githubInstallationId',
        'hostname',
        'level',
        'msg',
        'outcome',
        'pid',
        'reason',
        'reqId',
        'time',
      ]),
    );
    expect(lines[0]?.['durationMs']).toEqual(expect.any(Number));
  },
);

test('a delivery recorded before is a duplicate with no reason', async () => {
  const server = await running();
  await deliverAndRead(server, 'pull_request', webhookFixture('pull_request'));
  const { response, line } = await deliverAndRead(server, 'pull_request', webhookFixture('pull_request'));
  expect(response.statusCode).toBe(200);
  expect(line).toMatchObject({ outcome: 'duplicate', reason: null, event: 'pull_request', deliveryId: ID });
});

test('the duration is the time since the request arrived, in whole milliseconds, and is not negative', async () => {
  const server = await running();
  const { line } = await deliverAndRead(server, 'pull_request', webhookFixture('pull_request'));
  const duration = line?.['durationMs'];
  expect(Number.isInteger(duration)).toBe(true);
  expect(duration).toBeGreaterThanOrEqual(0);
  expect(duration).toBeLessThan(10_000);
});

const PR_TEXT = JSON.stringify(webhookFixture('pull_request'));
const BROKEN_TEXT = '{"broken":';

interface Refusal {
  readonly label: string;
  readonly status: number;
  readonly code: string;
  readonly body: string;
  readonly headers: Record<string, string>;
}

const REFUSED: readonly Refusal[] = [
  {
    label: 'a bad signature',
    status: 401,
    code: 'webhook_signature_invalid',
    body: PR_TEXT,
    headers: deliveryHeaders(PR_TEXT, { signature: sign('some-other-secret-value', PR_TEXT) }),
  },
  {
    label: 'a delivery id that is not a UUID',
    status: 400,
    code: 'webhook_header_invalid',
    body: PR_TEXT,
    headers: deliveryHeaders(PR_TEXT, { headers: { 'x-github-delivery': 'not-a-uuid' } }),
  },
  {
    label: 'a form body',
    status: 415,
    code: 'webhook_unsupported_media_type',
    body: PR_TEXT,
    headers: deliveryHeaders(PR_TEXT, { headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
  },
  {
    label: 'a body that is not JSON',
    status: 400,
    code: 'webhook_payload_invalid',
    body: BROKEN_TEXT,
    headers: deliveryHeaders(BROKEN_TEXT),
  },
];

test.each(REFUSED)('$label is one rejected line with the code of the error and no event', async (refusal) => {
  const server = await running();
  const before = server.logs.lines().length;
  const response = await postDelivery(server.app, refusal.body, refusal.headers);
  expect(response.statusCode).toBe(refusal.status);
  expect(receivedSince(server.logs, before)).toMatchObject([
    {
      event: null,
      action: null,
      deliveryId: null,
      githubInstallationId: null,
      outcome: 'rejected',
      reason: refusal.code,
    },
  ]);
});

test('a payload that fails its schema is rejected, with the event and the delivery id the headers gave and no action', async () => {
  const server = await running();
  const { response, line } = await deliverAndRead(
    server,
    'pull_request',
    withValue(webhookFixture('pull_request'), 'installation.id', 'one'),
  );
  expect(response.statusCode).toBe(400);
  expect(line).toMatchObject({
    event: 'pull_request',
    action: null,
    deliveryId: ID,
    githubInstallationId: null,
    outcome: 'rejected',
    reason: 'webhook_payload_invalid',
  });
});

test('a send that fails is rejected as webhook_enqueue_failed, with everything the delivery was known by', async () => {
  const server = await running();
  server.failSends(new Error('the queue is down'));
  const { response, line } = await deliverAndRead(server, 'pull_request', webhookFixture('pull_request'));
  expect(response.statusCode).toBe(503);
  expect(line).toMatchObject({
    event: 'pull_request',
    action: 'opened',
    deliveryId: ID,
    githubInstallationId: FIXTURE_IDS.installation,
    outcome: 'rejected',
    reason: 'webhook_enqueue_failed',
  });
});

test('a failure nobody planned is rejected as unexpected_error: a constant, never the error text', async () => {
  const server = await running();
  const broken = vi.spyOn(webhookDeliverySchema, 'safeParse').mockImplementation(() => {
    throw new Error('the schema is broken: super-secret-detail');
  });
  const { response, line } = await deliverAndRead(server, 'pull_request', webhookFixture('pull_request'));
  broken.mockRestore();
  expect(response.statusCode).toBe(500);
  expect(line).toMatchObject({ event: 'pull_request', outcome: 'rejected', reason: 'unexpected_error' });
  expect(JSON.stringify(line)).not.toContain('super-secret-detail');
});

/** U+202E, written as a code point so the source holds no bidirectional control character. */
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);

const ACTIONS = [
  ['ready_for_review', 'ready_for_review'],
  ['a'.repeat(64), 'a'.repeat(64)],
  ['Opened', null],
  ['opened ', null],
  ['review-requested', null],
  ['', null],
  ['<script>alert(1)</script>', null],
  [`${RIGHT_TO_LEFT_OVERRIDE}opened`, null],
] as const;

test.each(ACTIONS)(
  'the action %j is logged as %j: only what has the shape of a GitHub action is copied',
  async (action, logged) => {
    const server = await running();
    const { line } = await deliverAndRead(
      server,
      'pull_request',
      withValue(webhookFixture('pull_request'), 'action', action),
    );
    expect(line?.['action']).toBe(logged);
  },
);
