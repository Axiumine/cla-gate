// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { randomUUID } from 'node:crypto';
import { afterAll, expect, test } from 'vitest';
import { clearRecords, deliveryRows, jobCount, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { TENANT } from '../../services/tenant-fixture/test-support.ts';
import {
  ABSENT,
  FIXTURE_IDS,
  type WebhookEvent,
  webhookFixture,
  withValue,
} from '../github/webhook-fixture/test-support.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, sharedTenantWebhookApp, sign } from './test-support.ts';

// What is recorded and sent for each tenant (E06-S06) with the tenant filter in front (E06-S05): a delivery that is
// turned away or ignored leaves no row, a delivery replaced by a sync leaves the sync, and one tenant's delivery never
// leaves a trace in another's.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };

type Running = Awaited<ReturnType<typeof sharedTenantWebhookApp>>;

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

/** A signed delivery of `event` under a delivery id of its own. */
function deliver(app: Running['app'], event: string, body: unknown, id = randomUUID()) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return postDelivery(
    app,
    text,
    deliveryHeaders(text, { headers: { 'x-github-event': event, 'x-github-delivery': id } }),
  );
}

interface Ids {
  readonly installation: number;
  readonly repository: number;
}

function payloadFor(event: WebhookEvent, ids: Ids) {
  return withValue(
    withValue(webhookFixture(event), 'installation.id', ids.installation),
    'repository.id',
    ids.repository,
  );
}

const TENANT_EVENTS: readonly WebhookEvent[] = ['pull_request', 'check_run', 'check_suite', 'issue_comment'];

const TURNED_AWAY = [
  ['rejected', TENANT.rejected, 'installation_not_admitted'],
  ['suspended', TENANT.suspended, 'installation_suspended'],
  ['deleted', TENANT.deleted, 'installation_deleted'],
] as const;

const TURNED_AWAY_ROWS = TENANT_EVENTS.flatMap((event) => TURNED_AWAY.map((row) => [event, ...row] as const));

test.each(TURNED_AWAY_ROWS)(
  'a %s delivery of a %s installation is ignored (%s): no row and no job',
  async (event, _state, ids, reason) => {
    const { app, db, enqueuer } = await running();
    const response = await deliver(app, event, payloadFor(event, ids));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'ignored', reason });
    expect(await deliveryRows(db)).toEqual([]);
    expect(await jobCount(db)).toBe(0);
    expect(enqueuer.calls).toEqual([]);
  },
);

const NO_JOB = [
  ['a ping', 'ping', { zen: 'x' }],
  ['an event nobody subscribed to', 'push', { ref: 'refs/heads/main' }],
  ['an action nobody handles', 'pull_request', withValue(webhookFixture('pull_request'), 'action', 'labeled')],
  [
    'a check of another App',
    'check_run',
    withValue(webhookFixture('check_run'), 'check_run.app.id', FIXTURE_IDS.app + 1),
  ],
  ['a comment of a bot', 'issue_comment', withValue(webhookFixture('issue_comment'), 'sender.type', 'Bot')],
  ['a comment on an issue', 'issue_comment', withValue(webhookFixture('issue_comment'), 'issue.pull_request', ABSENT)],
  ['a comment without the command', 'issue_comment', withValue(webhookFixture('issue_comment'), 'comment.body', 'ok')],
  [
    'an authorisation of another action',
    'github_app_authorization',
    withValue(webhookFixture('github_app_authorization'), 'action', 'granted'),
  ],
] as const;

test.each(NO_JOB)('%s starts no job and inserts no row at all', async (_label, event, payload) => {
  const { app, db, enqueuer } = await running();
  const response = await deliver(app, event, payload);
  expect(response.statusCode).toBe(event === 'ping' ? 200 : 202);
  expect(await deliveryRows(db)).toEqual([]);
  expect(enqueuer.calls).toEqual([]);
});

test('an installation nobody stored: the delivery is recorded as the sync of that installation, and the event is ignored', async () => {
  const { app, db } = await running();
  const id = randomUUID();
  const response = await deliver(app, 'pull_request', payloadFor('pull_request', TENANT.unknown), id);
  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ status: 'ignored', reason: 'installation_unknown' });
  expect(await deliveryRows(db)).toMatchObject([{ delivery_id: id, event: 'pull_request', action: 'opened' }]);
  expect(await sentJobs(db)).toEqual([
    {
      idempotencyKey: id,
      dedupeKey: null,
      job: { type: 'sync-installation', githubInstallationId: TENANT.unknown.installation, deliveryId: id },
    },
  ]);
});

test('the sync that replaced a delivery is not sent twice: a redelivery is a 200 duplicate', async () => {
  const { app, db } = await running();
  const id = randomUUID();
  await deliver(app, 'pull_request', payloadFor('pull_request', TENANT.unknown), id);
  const again = await deliver(app, 'pull_request', payloadFor('pull_request', TENANT.unknown), id);
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual({ status: 'duplicate' });
  expect(await jobCount(db)).toBe(1);
});

test('a payload naming installation A and a repository stored under B: only the sync of A is sent, and B is not named', async () => {
  const { app, db } = await running();
  const stolen = { installation: TENANT.admitted.installation, repository: TENANT.other.repository };
  const response = await deliver(app, 'pull_request', payloadFor('pull_request', stolen));
  expect(response.json()).toEqual({ status: 'ignored', reason: 'repository_installation_mismatch' });
  const jobs = await sentJobs(db);
  expect(jobs.map((sent) => sent.job)).toMatchObject([
    { type: 'sync-installation', githubInstallationId: TENANT.admitted.installation },
  ]);
  const text = JSON.stringify([jobs, await deliveryRows(db)]);
  expect(text).not.toContain(String(TENANT.other.installation));
  expect(text).not.toContain(String(TENANT.other.repository));
});

test('two tenants deliver: each has its own row and a job that carries its own ids and no other', async () => {
  const { app, db } = await running();
  const a = randomUUID();
  const b = randomUUID();
  expect((await deliver(app, 'pull_request', payloadFor('pull_request', TENANT.admitted), a)).statusCode).toBe(202);
  expect((await deliver(app, 'pull_request', payloadFor('pull_request', TENANT.other), b)).statusCode).toBe(202);
  const jobs = await sentJobs(db);
  expect(jobs).toMatchObject([
    {
      idempotencyKey: a,
      job: {
        type: 'evaluate-pr',
        githubInstallationId: TENANT.admitted.installation,
        githubRepoId: TENANT.admitted.repository,
      },
    },
    {
      idempotencyKey: b,
      job: {
        type: 'evaluate-pr',
        githubInstallationId: TENANT.other.installation,
        githubRepoId: TENANT.other.repository,
      },
    },
  ]);
  const [first, second] = jobs.map((sent) => JSON.stringify(sent));
  expect(first).not.toContain(String(TENANT.other.installation));
  expect(second).not.toContain(String(TENANT.admitted.installation));
});

test("a redelivery of one tenant's delivery sends nothing and touches neither row: both stay for their live jobs", async () => {
  const { app, db } = await running();
  const a = randomUUID();
  const b = randomUUID();
  await deliver(app, 'pull_request', payloadFor('pull_request', TENANT.admitted), a);
  await deliver(app, 'pull_request', payloadFor('pull_request', TENANT.other), b);
  const before = await deliveryRows(db);
  expect((await deliver(app, 'pull_request', payloadFor('pull_request', TENANT.admitted), a)).statusCode).toBe(200);
  expect(await deliveryRows(db)).toEqual(before);
  expect(Object.fromEntries(before.map((row) => [row.delivery_id, row.processed_at]))).toEqual({
    [a]: null,
    [b]: null,
  });
  expect(await jobCount(db)).toBe(2);
});

const LIFECYCLE: readonly (readonly [WebhookEvent, string])[] = [
  ['installation', 'created'],
  ['installation', 'deleted'],
  ['installation_repositories', 'added'],
];

test.each(LIFECYCLE)(
  'the %s %s of a rejected account is recorded and sent as a sync of that installation',
  async (event, action) => {
    const { app, db } = await running();
    const payload = withValue(
      withValue(webhookFixture(event), 'action', action),
      'installation.id',
      TENANT.rejected.installation,
    );
    const response = await deliver(app, event, payload);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'accepted' });
    expect(await deliveryRows(db)).toMatchObject([{ event, action }]);
    expect((await sentJobs(db)).map((sent) => sent.job)).toMatchObject([
      { type: 'sync-installation', githubInstallationId: TENANT.rejected.installation },
    ]);
  },
);

test('an authorisation revoked names no installation: it is recorded and its job holds the user id only', async () => {
  const { app, db } = await running();
  await deliver(app, 'github_app_authorization', webhookFixture('github_app_authorization'));
  const [sent, ...others] = await sentJobs(db);
  expect(others).toEqual([]);
  expect(Object.keys(sent?.job ?? {}).toSorted((x, y) => x.localeCompare(y))).toEqual([
    'deliveryId',
    'githubUserId',
    'type',
  ]);
});

const REFUSED_BEFORE_RECORDING: readonly (readonly [string, (body: string) => Record<string, string>, number])[] = [
  [
    'a signature that does not verify',
    (body) =>
      deliveryHeaders(body, {
        signature: sign('another secret value', body),
        headers: { 'x-github-event': 'pull_request' },
      }),
    401,
  ],
  [
    'a missing delivery id',
    (body) => deliveryHeaders(body, { headers: { 'x-github-event': 'pull_request', 'x-github-delivery': undefined } }),
    400,
  ],
  [
    'a delivery id that is not a UUID',
    (body) => deliveryHeaders(body, { headers: { 'x-github-event': 'pull_request', 'x-github-delivery': '7' } }),
    400,
  ],
  [
    'a form-encoded body',
    (body) =>
      deliveryHeaders(body, {
        headers: { 'x-github-event': 'pull_request', 'content-type': 'application/x-www-form-urlencoded' },
      }),
    415,
  ],
];

test.each(REFUSED_BEFORE_RECORDING)(
  '%s is refused with its own status and records nothing',
  async (_label, headersOf, status) => {
    const { app, db, enqueuer } = await running();
    const text = JSON.stringify(webhookFixture('pull_request'));
    const response = await postDelivery(app, text, headersOf(text));
    expect(response.statusCode).toBe(status);
    expect(await deliveryRows(db)).toEqual([]);
    expect(enqueuer.calls).toEqual([]);
  },
);

test.each([
  ['a body that is not JSON', '{"action":'],
  ['a payload that fails its schema', JSON.stringify(withValue(webhookFixture('pull_request'), 'installation.id', 0))],
])('%s is a 400 and records nothing', async (_label, text) => {
  const { app, db, enqueuer } = await running();
  const response = await deliver(app, 'pull_request', text);
  expect(response.statusCode).toBe(400);
  expect(await deliveryRows(db)).toEqual([]);
  expect(enqueuer.calls).toEqual([]);
});
