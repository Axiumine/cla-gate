// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  FIXTURE_IDS,
  prototypeNames,
  type WebhookEvent,
  webhookFixture,
  withValue,
} from '../github/webhook-fixture/test-support.ts';
import { webhookDeliverySchema } from '../github/webhook-schemas.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, sign, webhookTestApp } from './test-support.ts';

// The event schemas (E06-S03) at the end of the chain, over the real route: signed deliveries of GitHub's events, and the
// answer a payload that fails its schema gets.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
const CANARY = 'canary-value-8e1f5b2a';

/** A signed delivery of `event` with `body`, the way GitHub sends one. */
function deliver(app: Awaited<ReturnType<typeof webhookTestApp>>['app'], event: string, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return postDelivery(app, text, deliveryHeaders(text, { headers: { 'x-github-event': event } }));
}

const EVENTS: readonly WebhookEvent[] = [
  'pull_request',
  'check_run',
  'check_suite',
  'issue_comment',
  'installation',
  'installation_repositories',
  'github_app_authorization',
];

test.each(EVENTS)('a signed %s delivery that fits its schema is acknowledged', async (event) => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const response = await deliver(app, event, webhookFixture(event));
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: 'verified' });
  expect(logs.text()).not.toContain('webhook.payload_invalid');
});

test('a payload that fails its schema is a 400 with the failed paths in the standard error body', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const broken = withValue(withValue(webhookFixture('pull_request'), 'repository.id', CANARY), 'pull_request.head', []);
  const response = await deliver(app, 'pull_request', broken);
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: {
      code: 'webhook_payload_invalid',
      message: 'Bad Request',
      requestId: response.headers['x-request-id'],
      details: { paths: ['pull_request.head', 'repository.id'] },
    },
  });
  expect(response.body).not.toContain(CANARY);
});

test('the log lists the failed paths and the event name, and not a value, a header or the body', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const broken = withValue(withValue(webhookFixture('issue_comment'), 'installation.id', CANARY), 'comment.body', 7);
  await deliver(app, 'issue_comment', broken);
  const lines = logs.lines();
  expect(lines.find((line) => line['msg'] === 'webhook.payload_invalid')).toMatchObject({
    event: 'issue_comment',
    paths: ['comment.body', 'installation.id'],
  });
  expect(lines.find((line) => line['msg'] === 'request rejected')).toMatchObject({
    statusCode: 400,
    code: 'webhook_payload_invalid',
  });
  expect(logs.text()).not.toContain(CANARY);
  expect(logs.text()).not.toContain('fixture-');
  expect(logs.text()).not.toContain(SECRET_CURRENT);
});

test('the event header decides the schema: a pull_request header over an issue_comment body is a 400', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await deliver(app, 'pull_request', webhookFixture('issue_comment'));
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({
    code: 'webhook_payload_invalid',
    details: { paths: ['number', 'pull_request'] },
  });
});

test('the schema comes last: an unsigned delivery is a 401, a bad header a 400 header error, whatever the payload', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const text = JSON.stringify({ action: 7 });
  const unsigned = await postDelivery(
    app,
    text,
    deliveryHeaders(text, {
      signature: sign('a-secret-nobody-configured', text),
      headers: { 'x-github-event': 'pull_request' },
    }),
  );
  expect(errorResponseSchema.parse(unsigned.json()).error.code).toBe('webhook_signature_invalid');
  const badHeader = await postDelivery(
    app,
    text,
    deliveryHeaders(text, { headers: { 'x-github-event': 'Pull-Request' } }),
  );
  expect(errorResponseSchema.parse(badHeader.json()).error.code).toBe('webhook_header_invalid');
  const form = await postDelivery(
    app,
    text,
    deliveryHeaders(text, {
      headers: { 'x-github-event': 'pull_request', 'content-type': 'application/x-www-form-urlencoded' },
    }),
  );
  expect(errorResponseSchema.parse(form.json()).error.code).toBe('webhook_unsupported_media_type');
  const broken = await deliver(app, 'pull_request', '{"action":');
  expect(errorResponseSchema.parse(broken.json()).error.code).toBe('webhook_payload_invalid');
  expect(errorResponseSchema.parse(broken.json()).error.details).toBeUndefined();
});

test.each([
  ['ping', 200, { status: 'pong' }],
  ['push', 202, { status: 'ignored', reason: 'unsupported_event' }],
  ['repository', 202, { status: 'ignored', reason: 'unsupported_event' }],
  ['constructor', 202, { status: 'ignored', reason: 'unsupported_event' }],
  ['__proto__', 202, { status: 'ignored', reason: 'unsupported_event' }],
] as const)(
  'the event %s has no schema, so any JSON object passes it and the router alone decides (%s, %j)',
  async (event, statusCode, body) => {
    const { app } = await webhookTestApp({ env: ENV });
    const response = await deliver(app, event, {
      action: { not: 'text' },
      installation: [1, 'x'],
      zen: 'Keep it simple.',
    });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual(body);
  },
);

test('a payload with __proto__ keys is acknowledged and leaves Object.prototype alone', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const before = prototypeNames();
  const body = JSON.stringify(webhookFixture('pull_request')).replace(
    '"installation":{',
    '"__proto__":{"polluted":true},"installation":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},',
  );
  const response = await deliver(app, 'pull_request', body);
  expect(response.statusCode).toBe(200);
  expect(Reflect.get({}, 'polluted')).toBeUndefined();
  expect(prototypeNames()).toEqual(before);
});

test('a repeated key in the body: the last one wins, so a last value that fails is a 400', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const tail = '"installation":{"id":31001},"installation":{"id":0}';
  const body = `${JSON.stringify(withValue(webhookFixture('pull_request'), 'installation', undefined)).slice(0, -1)},${tail}}`;
  const response = await deliver(app, 'pull_request', body);
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error.details).toEqual({ paths: ['installation.id'] });
});

test('a schema that throws something that is not a validation failure is a 500, and the log holds no body', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const spy = vi.spyOn(webhookDeliverySchema, 'safeParse').mockImplementation(() => {
    throw new Error('the schema is broken');
  });
  const body = withValue(webhookFixture('pull_request'), 'pull_request.title', CANARY);
  const response = await deliver(app, 'pull_request', body);
  spy.mockRestore();
  expect(response.statusCode).toBe(500);
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: {
      code: 'internal_server_error',
      message: 'Internal Server Error',
      requestId: response.headers['x-request-id'],
    },
  });
  expect(logs.lines().find((line) => line['msg'] === 'unhandled error')).toBeDefined();
  expect(logs.text()).not.toContain(CANARY);
  expect(logs.text()).not.toContain('fixture-');
  expect((await deliver(app, 'pull_request', webhookFixture('pull_request'))).statusCode).toBe(200);
});
