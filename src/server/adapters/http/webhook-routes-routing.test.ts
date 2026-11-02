// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  ABSENT,
  FIXTURE_IDS,
  type WebhookEvent,
  webhookFixture,
  withValue,
} from '../github/webhook-fixture/test-support.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, tenantWebhookApp, webhookTestApp } from './test-support.ts';

// The routing table (E06-S04) over the real route: what a signed delivery of each event is answered with. A delivery
// that becomes a job is recorded and its job sent (E06-S06) and answered 202 `accepted`; one that does not is a 202
// `ignored` with the reason; a ping is a 200 `pong`.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const CANARY = 'canary-value-8e1f5b2a';

const ACCEPTED = { status: 'accepted' };
const ignored = (reason: string) => ({ status: 'ignored', reason });

function deliver(app: Awaited<ReturnType<typeof webhookTestApp>>['app'], event: string, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return postDelivery(app, text, deliveryHeaders(text, { headers: { 'x-github-event': event } }));
}

interface Row {
  readonly title: string;
  readonly event: WebhookEvent;
  readonly payload: Record<string, unknown>;
  readonly statusCode: number;
  readonly body: object;
}

const fixture = (event: WebhookEvent, ...changes: readonly (readonly [path: string, value: unknown])[]) =>
  changes.reduce((payload, [path, value]) => withValue(payload, path, value), webhookFixture(event));

const ROWS: readonly Row[] = [
  {
    title: 'a pull request opened',
    event: 'pull_request',
    payload: fixture('pull_request'),
    statusCode: 202,
    body: ACCEPTED,
  },
  {
    title: 'a pull request closed',
    event: 'pull_request',
    payload: fixture('pull_request', ['action', 'closed']),
    statusCode: 202,
    body: ACCEPTED,
  },
  {
    title: 'a pull request labeled',
    event: 'pull_request',
    payload: fixture('pull_request', ['action', 'labeled']),
    statusCode: 202,
    body: ignored('unsupported_action'),
  },
  {
    title: 'a check run re-requested',
    event: 'check_run',
    payload: fixture('check_run'),
    statusCode: 202,
    body: ACCEPTED,
  },
  {
    title: 'a check run completed',
    event: 'check_run',
    payload: fixture('check_run', ['action', 'completed']),
    statusCode: 202,
    body: ignored('unsupported_action'),
  },
  {
    title: 'a check run of another name',
    event: 'check_run',
    payload: fixture('check_run', ['check_run.name', 'ci/build']),
    statusCode: 202,
    body: ignored('foreign_check'),
  },
  {
    title: 'a check run of another App',
    event: 'check_run',
    payload: fixture('check_run', ['check_run.app.id', FIXTURE_IDS.app + 1]),
    statusCode: 202,
    body: ignored('foreign_check'),
  },
  {
    title: 'a check suite re-requested',
    event: 'check_suite',
    payload: fixture('check_suite'),
    statusCode: 202,
    body: ACCEPTED,
  },
  {
    title: 'a check suite of another App',
    event: 'check_suite',
    payload: fixture('check_suite', ['check_suite.app.id', FIXTURE_IDS.app + 1]),
    statusCode: 202,
    body: ignored('foreign_check'),
  },
  {
    title: 'a /recheck comment',
    event: 'issue_comment',
    payload: fixture('issue_comment'),
    statusCode: 202,
    body: ACCEPTED,
  },
  {
    title: 'a comment without the command',
    event: 'issue_comment',
    payload: fixture('issue_comment', ['comment.body', 'looks good']),
    statusCode: 202,
    body: ignored('no_recheck_command'),
  },
  {
    title: 'a /recheck comment from a Bot',
    event: 'issue_comment',
    payload: fixture('issue_comment', ['sender.type', 'Bot']),
    statusCode: 202,
    body: ignored('bot_sender'),
  },
  {
    title: 'a /recheck comment on an issue',
    event: 'issue_comment',
    payload: fixture('issue_comment', ['issue.pull_request', ABSENT]),
    statusCode: 202,
    body: ignored('not_pull_request'),
  },
  {
    title: 'an edited comment',
    event: 'issue_comment',
    payload: fixture('issue_comment', ['action', 'edited']),
    statusCode: 202,
    body: ignored('unsupported_action'),
  },
  {
    title: 'an installation created',
    event: 'installation',
    payload: fixture('installation'),
    statusCode: 202,
    body: ACCEPTED,
  },
  {
    title: 'an installation action GitHub adds later',
    event: 'installation',
    payload: fixture('installation', ['action', 'a_new_action']),
    statusCode: 202,
    body: ACCEPTED,
  },
  {
    title: 'repositories added to an installation',
    event: 'installation_repositories',
    payload: fixture('installation_repositories'),
    statusCode: 202,
    body: ACCEPTED,
  },
  {
    title: 'an authorisation revoked',
    event: 'github_app_authorization',
    payload: fixture('github_app_authorization'),
    statusCode: 202,
    body: ACCEPTED,
  },
  {
    title: 'an authorisation of another action',
    event: 'github_app_authorization',
    payload: fixture('github_app_authorization', ['action', 'granted']),
    statusCode: 202,
    body: ignored('unsupported_action'),
  },
];

/**
 * A delivery that becomes a job reads the tenant (E06-S05) and is recorded (E06-S06), so its app has the database of
 * the tenants. One that is ignored or answered before that has a database that refuses every connection, so a read or
 * a write would fail the row.
 */
test.each(ROWS)('$title is answered $statusCode', async ({ event, payload, statusCode, body }) => {
  const { app } = await (body === ACCEPTED ? tenantWebhookApp : webhookTestApp)({ env: ENV });
  const response = await deliver(app, event, payload);
  expect(response.statusCode).toBe(statusCode);
  expect(response.json()).toEqual(body);
});

test('a ping is answered 200 pong, whatever the body holds', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await deliver(app, 'ping', { zen: 'Keep it logically awesome.', hook_id: 1, installation: 'x' });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: 'pong' });
  expect(response.headers['content-type']).toMatch(/^application\/json/);
});

test('with no GITHUB_APP_ID configured no check is ours, and the other events are routed as usual', async () => {
  const { app } = await tenantWebhookApp({ env: { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT } });
  expect((await deliver(app, 'check_run', webhookFixture('check_run'))).json()).toEqual(ignored('foreign_check'));
  expect((await deliver(app, 'check_suite', webhookFixture('check_suite'))).json()).toEqual(ignored('foreign_check'));
  expect((await deliver(app, 'pull_request', webhookFixture('pull_request'))).json()).toEqual(ACCEPTED);
});

test.each(['push', 'repository', 'merge_group', 'issues', 'workflow_run', 'constructor', '__proto__'])(
  'the event %s, which the App is not subscribed to, is a 202 unsupported_event',
  async (event) => {
    const { app } = await webhookTestApp({ env: ENV });
    const response = await deliver(app, event, { action: 'opened', zen: CANARY });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(ignored('unsupported_event'));
  },
);

test('a delivery is routed only after the signature, the envelope and the schema: each refusal comes first', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const text = JSON.stringify(webhookFixture('pull_request'));
  const unsigned = await postDelivery(
    app,
    text,
    deliveryHeaders(text, { signature: 'sha256='.concat('0'.repeat(64)), headers: { 'x-github-event': 'ping' } }),
  );
  expect(unsigned.statusCode).toBe(401);
  const unsignedUnknown = await postDelivery(
    app,
    text,
    deliveryHeaders(text, { signature: 'sha256='.concat('0'.repeat(64)), headers: { 'x-github-event': 'push' } }),
  );
  expect(unsignedUnknown.statusCode).toBe(401);
  const badJson = await deliver(app, 'ping', '{"zen":');
  expect(errorResponseSchema.parse(badJson.json()).error.code).toBe('webhook_payload_invalid');
  const badSchema = await deliver(
    app,
    'pull_request',
    fixture('pull_request', ['action', 'labeled'], ['installation.id', 0]),
  );
  expect(errorResponseSchema.parse(badSchema.json()).error.code).toBe('webhook_payload_invalid');
});

test('the answer holds constants of the server only: not the action, the event, the body or a header of the delivery', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const labeled = await deliver(
    app,
    'pull_request',
    fixture('pull_request', ['action', `labeled-${CANARY}`], ['pull_request.title', CANARY]),
  );
  expect(labeled.statusCode).toBe(202);
  expect(labeled.json()).toEqual(ignored('unsupported_action'));
  expect(labeled.body).not.toContain(CANARY);
  const unknown = await deliver(app, 'canary_event', { zen: CANARY });
  expect(unknown.json()).toEqual(ignored('unsupported_event'));
  expect(unknown.body).not.toContain('canary');
});

test('an ignored delivery leaves the app serving: the next delivery is routed', async () => {
  const { app } = await tenantWebhookApp({ env: ENV });
  expect((await deliver(app, 'push', { ref: 'refs/heads/main' })).statusCode).toBe(202);
  expect((await deliver(app, 'pull_request', webhookFixture('pull_request'))).statusCode).toBe(202);
});
