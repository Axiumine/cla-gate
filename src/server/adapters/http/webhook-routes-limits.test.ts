// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { authWorld } from './auth-fixture/test-support.ts';
import { HTTP_LIMITS, WEBHOOK_BODY_LIMIT } from './limits.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, sign, webhookTestApp } from './test-support.ts';

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT };
const TEN_MIB = 10 * 1024 * 1024;

/** A JSON object of exactly `bytes` bytes: one string member padded to length. */
function jsonOfSize(bytes: number, marker = 'padding'): Buffer {
  const frame = Buffer.byteLength(`{"${marker}":""}`);
  return Buffer.from(`{"${marker}":"${'a'.repeat(bytes - frame)}"}`);
}

test('the webhook body limit is 10 MiB, 10_485_760 bytes, and the other routes keep their 1 MiB', () => {
  expect(WEBHOOK_BODY_LIMIT).toBe(10_485_760);
  expect(WEBHOOK_BODY_LIMIT).toBe(TEN_MIB);
  expect(HTTP_LIMITS.bodyLimit).toBe(1_048_576);
});

test('a body of exactly 10 MiB passes the size check, the signature and the envelope', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const body = jsonOfSize(TEN_MIB);
  expect(body).toHaveLength(10_485_760);
  const response = await postDelivery(app, body);
  expect(response.statusCode).toBe(200);
});

test('a body of 10 MiB plus one byte is a 413 webhook_payload_too_large with the standard body', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const body = jsonOfSize(TEN_MIB + 1);
  expect(body).toHaveLength(10_485_761);
  const response = await postDelivery(app, body);
  expect(response.statusCode).toBe(413);
  expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: {
      code: 'webhook_payload_too_large',
      message: 'Payload Too Large',
      requestId: response.headers['x-request-id'],
    },
  });
});

test('the size is checked before the signature: an oversize body with a bad or no signature is a 413, not a 401', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const body = jsonOfSize(TEN_MIB + 1);
  const bad = await postDelivery(
    app,
    body,
    deliveryHeaders(body, { signature: sign('a-secret-nobody-configured', body) }),
  );
  const none = await postDelivery(app, body, { 'content-type': 'application/json' });
  const broken = await postDelivery(app, Buffer.alloc(TEN_MIB + 1, 0x5b), { 'content-type': 'text/plain' });
  expect([bad.statusCode, none.statusCode, broken.statusCode]).toEqual([413, 413, 413]);
  for (const response of [bad, none, broken]) {
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_payload_too_large');
  }
});

test('an oversize body is not echoed: neither the response nor the log holds a fragment of it', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const body = jsonOfSize(TEN_MIB + 1, 'canary-8c1f4e7a');
  const response = await postDelivery(app, body);
  expect(`${logs.text()}${response.body}`).not.toContain('canary-8c1f4e7a');
  expect(response.statusCode).toBe(413);
});

test('another route keeps the 1 MiB limit of the application and its own error code', async () => {
  // A state-changing route is behind the login's guards (E10-S03), so the caller is a person who is logged in.
  const { app, login } = await authWorld(ENV);
  const alice = await login(1001);
  const headers = { ...alice.headers, 'content-type': 'application/json' };
  const post = (payload: Buffer) => app.inject({ method: 'POST', url: '/probe/mutate', headers, payload });
  const within = await post(jsonOfSize(1_048_576));
  const over = await post(jsonOfSize(1_048_577));
  expect(within.statusCode).toBe(200);
  expect(over.statusCode).toBe(413);
  expect(errorResponseSchema.parse(over.json()).error.code).toBe('payload_too_large');
  // The same 2 MiB that the webhook route takes is far over what that route takes.
  const two = jsonOfSize(2 * 1024 * 1024);
  expect((await postDelivery(app, two)).statusCode).toBe(200);
  expect((await post(two)).statusCode).toBe(413);
});
