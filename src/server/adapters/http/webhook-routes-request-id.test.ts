// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { freePort, sendRaw } from '../../test-support.ts';
import { deliveryHeaders, SECRET_CURRENT, webhookTestApp } from './test-support.ts';

// No header value of a webhook delivery reaches the log (E06-S07), the request id included: the route mints its own id
// for every way of writing its address that Fastify's router resolves to it, not for the one spelling of the constant.
// The id comes from the route that matched, not from a comparison of the request target with the path.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT };
const ATTACKER_ID = 'attacker-chosen-id-1234';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BODY = '{"zen":"x"}';

/** Spellings of the path that reach the route through `inject`: percent-escapes of letters, with and without a query. */
const INJECTED_TARGETS = [
  WEBHOOK_PATH,
  `${WEBHOOK_PATH}?delivery=1`,
  '/webhooks/%67ithub',
  '/%77ebhooks/github',
  '/webhooks/gith%75b',
  '/%77%65%62hooks/%67%69%74%68%75%62',
];

/** Spellings that only a raw request line can carry: a fragment and the absolute form of the target. */
const RAW_TARGETS = [
  `${WEBHOOK_PATH}#fragment`,
  '/webhooks/%67ithub#fragment',
  `http://127.0.0.1${WEBHOOK_PATH}`,
  'http://127.0.0.1/webhooks/%67ithub',
];

test.each(INJECTED_TARGETS)(
  'a delivery to %s gets a minted request id, in the header and in every log line',
  async (url) => {
    const { app, logs } = await webhookTestApp({ env: ENV });
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { ...deliveryHeaders(BODY), 'x-request-id': ATTACKER_ID },
      payload: BODY,
    });
    expect([response.statusCode, response.json()]).toEqual([200, { status: 'pong' }]);
    const id = response.headers['x-request-id'];
    expect(id).toMatch(UUID);
    expect(logs.text()).not.toContain(ATTACKER_ID);
    const received = logs.lines().filter((line) => line['msg'] === 'webhook.received');
    expect(received.map((line) => line['reqId'])).toEqual([id]);
  },
);

test.each(RAW_TARGETS)('a delivery written to the socket as %s gets a minted request id too', async (target) => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const address = await app.listen({ host: '127.0.0.1', port: await freePort() });
  const request = [
    `POST ${target} HTTP/1.1`,
    'Host: 127.0.0.1',
    `Content-Length: ${BODY.length}`,
    ...Object.entries(deliveryHeaders(BODY)).map(([name, value]) => `${name}: ${value}`),
    `X-Request-Id: ${ATTACKER_ID}`,
    'Connection: close',
    '',
    BODY,
  ].join('\r\n');
  const answer = await sendRaw(address, request);
  expect(answer.statusLine).toBe('HTTP/1.1 200 OK');
  expect(answer.headers['x-request-id']).toMatch(UUID);
  expect(logs.text()).not.toContain(ATTACKER_ID);
});

test('a refused delivery (no signature) gets a minted id as well: the id is not chosen by the answer', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/%67ithub',
    headers: { 'content-type': 'application/json', 'x-request-id': ATTACKER_ID },
    payload: BODY,
  });
  expect(response.statusCode).toBe(401);
  expect(response.headers['x-request-id']).toMatch(UUID);
  expect(logs.text()).not.toContain(ATTACKER_ID);
});

test('every other route keeps a well formed id of the caller, so a trace can span services', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': ATTACKER_ID } });
  expect(response.headers['x-request-id']).toBe(ATTACKER_ID);
});
