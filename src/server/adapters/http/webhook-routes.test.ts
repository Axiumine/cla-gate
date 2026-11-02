// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import Fastify from 'fastify';
import { expect, onTestFinished, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { systemClock } from '../../services/ports/clock.ts';
import { FakeClock } from '../../services/test-support.ts';
import { auditProblem } from './audit-routes.ts';
import {
  deliveryHeaders,
  GITHUB_EXAMPLE,
  postDelivery,
  SECRET_CURRENT,
  SECRET_PREVIOUS,
  sign,
  signLegacy,
  unreachableDatabase,
  watchTimingSafeEqual,
  webhookTestApp,
} from './test-support.ts';
import { webhookRoutes } from './webhook-routes.ts';

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_WEBHOOK_SECRET_PREVIOUS: SECRET_PREVIOUS };
const PAYLOAD = '{"action":"opened","number":7,"pull_request":{"number":7}}';
const START = '2026-11-02T10:00:00.000Z';

test('GitHub documented example passes the signature check: it is refused later, as not JSON, never as a 401', async () => {
  const { app } = await webhookTestApp({ env: { GITHUB_WEBHOOK_SECRET: GITHUB_EXAMPLE.secret } });
  const response = await postDelivery(
    app,
    GITHUB_EXAMPLE.body,
    deliveryHeaders(GITHUB_EXAMPLE.body, { signature: GITHUB_EXAMPLE.signature }),
  );
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('webhook_payload_invalid');
});

test('a delivery signed with the current secret is accepted and logs no rotation warning', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const response = await postDelivery(app, PAYLOAD);
  expect(response.statusCode).toBe(200);
  expect(logs.lines().some((line) => line['msg'] === 'webhook.secret_previous_used')).toBe(false);
});

test('a delivery signed with the previous secret is accepted and logs one rotation warning', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const response = await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { secret: SECRET_PREVIOUS }));
  expect(response.statusCode).toBe(200);
  const warnings = logs.lines().filter((line) => line['msg'] === 'webhook.secret_previous_used');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({ level: 40 });
});

test('the rotation warning is logged at most once a minute', async () => {
  const clock = new FakeClock(START);
  const { app, logs } = await webhookTestApp({ env: ENV, clock });
  const previous = deliveryHeaders(PAYLOAD, { secret: SECRET_PREVIOUS });
  const warnings = () => logs.lines().filter((line) => line['msg'] === 'webhook.secret_previous_used').length;
  await postDelivery(app, PAYLOAD, previous);
  clock.advance(30_000);
  await postDelivery(app, PAYLOAD, previous);
  clock.advance(29_999);
  await postDelivery(app, PAYLOAD, previous);
  expect(warnings()).toBe(1);
  clock.advance(1);
  await postDelivery(app, PAYLOAD, previous);
  expect(warnings()).toBe(2);
  clock.advance(59_999);
  await postDelivery(app, PAYLOAD, previous);
  expect(warnings()).toBe(2);
});

test('a delivery with the current secret does not use up the minute of the rotation warning', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV, clock: new FakeClock(START) });
  await postDelivery(app, PAYLOAD);
  await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { secret: SECRET_PREVIOUS }));
  expect(logs.lines().filter((line) => line['msg'] === 'webhook.secret_previous_used')).toHaveLength(1);
});

test('a refused delivery never logs the rotation warning', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { secret: 'a-secret-nobody-configured' }));
  expect(logs.lines().some((line) => line['msg'] === 'webhook.secret_previous_used')).toBe(false);
});

test('a body signed by the previous secret is refused once that secret is removed', async () => {
  const { app } = await webhookTestApp({ env: { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT } });
  const response = await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { secret: SECRET_PREVIOUS }));
  expect(response.statusCode).toBe(401);
});

test('with no secret configured every delivery is refused, whatever it is signed with', async () => {
  const { app } = await webhookTestApp();
  for (const secret of [SECRET_CURRENT, '', 'undefined']) {
    const response = await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { secret }));
    expect(response.statusCode).toBe(401);
  }
});

test('the empty body with the valid signature of the empty string passes the signature and is refused as a payload', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const withHeaders = await postDelivery(app, '', deliveryHeaders(''));
  const bare = await app.inject({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: { 'x-hub-signature-256': sign(SECRET_CURRENT, '') },
  });
  expect(withHeaders.statusCode).toBe(400);
  expect(errorResponseSchema.parse(withHeaders.json()).error.code).toBe('webhook_payload_invalid');
  // No delivery headers at all: refused by the header check, which only a signed request reaches.
  expect(bare.statusCode).toBe(400);
  expect(errorResponseSchema.parse(bare.json()).error.code).toBe('webhook_header_invalid');
});

test('the empty body is refused when the signature is that of any other body', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await app.inject({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: { 'x-hub-signature-256': sign(SECRET_CURRENT, PAYLOAD) },
  });
  expect(response.statusCode).toBe(401);
});

test('a request with no signature header is refused with the standard error body', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const response = await postDelivery(app, PAYLOAD, { 'content-type': 'application/json' });
  expect(response.statusCode).toBe(401);
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: { code: 'webhook_signature_invalid', message: 'Unauthorized', requestId: response.headers['x-request-id'] },
  });
});

test('the legacy SHA-1 header alone is refused, even when it is a correct HMAC', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const legacy = signLegacy(SECRET_CURRENT, PAYLOAD);
  const response = await postDelivery(app, PAYLOAD, { 'content-type': 'application/json', 'x-hub-signature': legacy });
  expect(response.statusCode).toBe(401);
});

test('the legacy header is ignored next to a good SHA-256 one and cannot rescue a bad one', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const legacy = signLegacy(SECRET_CURRENT, PAYLOAD);
  const good = { ...deliveryHeaders(PAYLOAD), 'x-hub-signature': 'sha1=garbage' };
  const bad = {
    ...deliveryHeaders(PAYLOAD, { signature: sign('wrong-secret-value-1', PAYLOAD) }),
    'x-hub-signature': legacy,
  };
  expect((await postDelivery(app, PAYLOAD, good)).statusCode).toBe(200);
  expect((await postDelivery(app, PAYLOAD, bad)).statusCode).toBe(401);
});

test('no body parser runs on a refused delivery: broken JSON, deep nesting and a form body are all a 401', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  app.post('/ordinary', () => 'ok');
  const parse = vi.spyOn(JSON, 'parse');
  onTestFinished(() => {
    parse.mockRestore();
  });
  // The control: the spy does see the JSON parser of an ordinary route, so a silent spy means no parser ran.
  await app.inject({ method: 'POST', url: '/ordinary', payload: { a: 1 } });
  expect(parse).toHaveBeenCalled();
  parse.mockClear();
  const nested = '['.repeat(1_048_576);
  const rows = [
    ['{"action": ', 'application/json'],
    [nested, 'application/json'],
    ['action=opened', 'application/x-www-form-urlencoded'],
    ['plain text', 'text/plain'],
    ['<xml/>', 'application/xml'],
  ] as const;
  for (const [body, type] of rows) {
    const headers = { 'content-type': type, 'x-hub-signature-256': sign('wrong-secret-value-1', body) };
    const response = await postDelivery(app, body, headers);
    expect(response.statusCode).toBe(401);
  }
  expect(parse).not.toHaveBeenCalled();
});

test('a signed body of any media type reaches the envelope checks as bytes: only JSON passes them', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  for (const type of ['application/x-www-form-urlencoded', 'text/plain', 'application/xml']) {
    const headers = deliveryHeaders(PAYLOAD, { headers: { 'content-type': type } });
    expect((await postDelivery(app, PAYLOAD, headers)).statusCode).toBe(415);
  }
  const latin1 = deliveryHeaders(PAYLOAD, { headers: { 'content-type': 'application/json; charset=latin1' } });
  expect((await postDelivery(app, PAYLOAD, latin1)).statusCode).toBe(200);
  const bare = deliveryHeaders(PAYLOAD, { headers: { 'content-type': undefined } });
  expect((await app.inject({ method: 'POST', url: WEBHOOK_PATH, headers: bare, payload: PAYLOAD })).statusCode).toBe(
    415,
  );
});

test('crypto.timingSafeEqual runs on every accepted delivery, once for each configured secret', async () => {
  const both = await webhookTestApp({ env: ENV });
  const compare = watchTimingSafeEqual();
  expect((await postDelivery(both.app, PAYLOAD)).statusCode).toBe(200);
  expect(compare).toHaveBeenCalledTimes(2);
  compare.mockClear();
  expect(
    (await postDelivery(both.app, PAYLOAD, deliveryHeaders(PAYLOAD, { secret: SECRET_PREVIOUS }))).statusCode,
  ).toBe(200);
  expect(compare).toHaveBeenCalledTimes(2);
  const single = await webhookTestApp({ env: { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT } });
  compare.mockClear();
  expect((await postDelivery(single.app, PAYLOAD)).statusCode).toBe(200);
  expect(compare).toHaveBeenCalledTimes(1);
});

test('the route needs no session, cookie, CSRF token or Origin header, and ignores them when present', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  const plain = await postDelivery(app, PAYLOAD);
  const noisy = await postDelivery(app, PAYLOAD, {
    ...deliveryHeaders(PAYLOAD),
    origin: 'https://evil.example',
    cookie: '__Host-sid=not-a-session',
    'x-csrf-token': 'nope',
  });
  expect(plain.statusCode).toBe(200);
  expect(noisy.statusCode).toBe(200);
});

test('the raw body belongs to this route only: another route still gets its JSON parsed', async () => {
  const { app } = await webhookTestApp({ env: ENV });
  app.post('/elsewhere', (request) => ({ body: request.body, raw: request.rawBody ?? null }));
  const response = await app.inject({ method: 'POST', url: '/elsewhere', payload: { a: 1 } });
  expect(response.json()).toEqual({ body: { a: 1 }, raw: null });
  const broken = await app.inject({
    method: 'POST',
    url: '/elsewhere',
    headers: { 'content-type': 'application/json' },
    payload: '{',
  });
  expect(broken.statusCode).toBe(400);
});

test('the route sits outside /api, so the audit guard does not apply, and it declares the webhook exemption', async () => {
  const app = Fastify();
  onTestFinished(async () => {
    await app.close();
  });
  const declared: { method: unknown; url: string; config: unknown }[] = [];
  app.addHook('onRoute', ({ method, url, config }) => {
    declared.push({ method, url, config });
  });
  const db = unreachableDatabase();
  onTestFinished(async () => {
    await db.destroy();
  });
  await app.register(webhookRoutes, {
    secrets: { current: undefined, previous: undefined },
    clock: systemClock,
    appId: undefined,
    db,
  });
  expect(declared).toHaveLength(1);
  expect(declared[0]).toMatchObject({
    method: 'POST',
    url: WEBHOOK_PATH,
    config: { rawBody: true, auditExempt: 'webhook' },
  });
  expect(auditProblem('POST', WEBHOOK_PATH, undefined)).toBeUndefined();
  expect(auditProblem('POST', WEBHOOK_PATH, declared[0]?.config)).toBeUndefined();
});

test('neither secret, nor any signature, nor any body fragment reaches the log or an error body', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  const bodies: string[] = [];
  const hostile = deliveryHeaders(PAYLOAD, { signature: sign('wrong-secret-value-1', PAYLOAD) });
  const sent = [
    await postDelivery(app, PAYLOAD),
    await postDelivery(app, PAYLOAD, deliveryHeaders(PAYLOAD, { secret: SECRET_PREVIOUS })),
    await postDelivery(app, PAYLOAD, hostile),
    await postDelivery(app, PAYLOAD, { 'content-type': 'application/json' }),
  ];
  for (const response of sent) {
    bodies.push(response.body);
  }
  const everything = `${logs.text()}\n${bodies.join('\n')}`;
  for (const secret of [SECRET_CURRENT, SECRET_PREVIOUS, 'wrong-secret-value-1']) {
    expect(everything).not.toContain(secret);
  }
  for (const header of [
    sign(SECRET_CURRENT, PAYLOAD),
    sign(SECRET_PREVIOUS, PAYLOAD),
    hostile['x-hub-signature-256'],
  ]) {
    expect(everything).not.toContain(header?.slice(7) ?? 'missing');
  }
  expect(everything).not.toContain('pull_request');
});
