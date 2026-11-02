// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { FakeClock } from '../../services/test-support.ts';
import {
  deliveryHeaders,
  SECRET_CURRENT,
  sign,
  watchCreateHmac,
  watchTimingSafeEqual,
  webhookTestApp,
} from './test-support.ts';

// The failed-signature throttle over the route (E06-S07): more than 30 failed verifications from one address within 60
// seconds are answered 429 with Retry-After until the window slides; only failures count; the address is request.ip.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT };
const BODY = '{"zen":"Keep it logically awesome."}';
const START = '2026-11-02T10:00:00.000Z';
const SECOND = 1000;
const GITHUB = '203.0.113.50';
const ATTACKER = '203.0.113.7';

/** A signed ping from `address`: a delivery the route answers 200 and records nothing for. */
function validFrom(app: FastifyInstance, address: string) {
  return app.inject({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: deliveryHeaders(BODY),
    payload: BODY,
    remoteAddress: address,
  });
}

/** A delivery from `address` whose signature is wrong (or missing, or malformed, by `kind`). */
function forgedFrom(app: FastifyInstance, address: string, kind = 0, headers: Record<string, string> = {}) {
  const forged = [
    sign('a-secret-nobody-configured', BODY),
    undefined,
    `sha1=${'0'.repeat(40)}`,
    `sha256=${'0'.repeat(63)}`,
    `sha256=${'g'.repeat(64)}`,
  ][kind % 5];
  const base = deliveryHeaders(BODY, { signature: forged ?? '', headers: { 'x-hub-signature-256': forged } });
  return app.inject({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers: { ...base, ...headers },
    payload: BODY,
    remoteAddress: address,
  });
}

async function statuses(count: number, send: (index: number) => Promise<{ statusCode: number }>) {
  const codes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    codes.push((await send(index)).statusCode);
  }
  return codes;
}

test('30 failed verifications are 401 each and the 31st is a 429 webhook_throttled with Retry-After, in the standard body', async () => {
  const { app } = await webhookTestApp({ env: ENV, clock: new FakeClock(START) });
  expect(await statuses(30, () => forgedFrom(app, ATTACKER))).toEqual(Array.from({ length: 30 }, () => 401));
  const held = await forgedFrom(app, ATTACKER);
  expect(held.statusCode).toBe(429);
  expect(held.headers['retry-after']).toBe('60');
  expect(held.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(errorResponseSchema.parse(held.json())).toEqual({
    error: { code: 'webhook_throttled', message: 'Too Many Requests', requestId: held.headers['x-request-id'] },
  });
});

test('every way to fail the verification counts the same: a missing, malformed, SHA-1 and wrong signature', async () => {
  const { app } = await webhookTestApp({ env: ENV, clock: new FakeClock(START) });
  const codes = await statuses(32, (index) => forgedFrom(app, ATTACKER, index));
  expect(codes.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 401));
  expect(codes.slice(30)).toEqual([429, 429]);
});

test('an address that is held back is refused whatever it sends, a valid delivery included, without any HMAC computed', async () => {
  const { app } = await webhookTestApp({ env: ENV, clock: new FakeClock(START) });
  await statuses(31, () => forgedFrom(app, ATTACKER));
  const headers = deliveryHeaders(BODY);
  const hmac = watchCreateHmac();
  const compare = watchTimingSafeEqual();
  const valid = await app.inject({
    method: 'POST',
    url: WEBHOOK_PATH,
    headers,
    payload: BODY,
    remoteAddress: ATTACKER,
  });
  expect(valid.statusCode).toBe(429);
  expect(valid.headers['retry-after']).toBe('60');
  expect(hmac).not.toHaveBeenCalled();
  expect(compare).not.toHaveBeenCalled();
});

test('the wait shrinks as the window slides, and the address is served again when it has passed', async () => {
  const clock = new FakeClock(START);
  const { app } = await webhookTestApp({ env: ENV, clock });
  await statuses(31, () => forgedFrom(app, ATTACKER));
  clock.advance(20 * SECOND);
  const waiting = await validFrom(app, ATTACKER);
  expect([waiting.statusCode, waiting.headers['retry-after']]).toEqual([429, '40']);
  clock.advance(40 * SECOND - 1);
  expect((await validFrom(app, ATTACKER)).statusCode).toBe(429);
  clock.advance(1);
  const served = await validFrom(app, ATTACKER);
  expect([served.statusCode, served.json()]).toEqual([200, { status: 'pong' }]);
});

test('a held-back address does not hold back another: GitHub is served while the attacker is refused', async () => {
  const { app } = await webhookTestApp({ env: ENV, clock: new FakeClock(START) });
  await statuses(31, () => forgedFrom(app, ATTACKER));
  expect((await validFrom(app, GITHUB)).statusCode).toBe(200);
  expect((await forgedFrom(app, GITHUB)).statusCode).toBe(401);
  expect((await validFrom(app, ATTACKER)).statusCode).toBe(429);
});

test('only failures count: a burst of 200 valid deliveries is never throttled and leaves the failure count at zero', async () => {
  const { app } = await webhookTestApp({ env: ENV, clock: new FakeClock(START) });
  expect(await statuses(200, () => validFrom(app, GITHUB))).toEqual(Array.from({ length: 200 }, () => 200));
  expect(await statuses(30, () => forgedFrom(app, GITHUB))).toEqual(Array.from({ length: 30 }, () => 401));
  expect((await forgedFrom(app, GITHUB)).statusCode).toBe(429);
});

test('valid deliveries between the failures do not reset the count', async () => {
  const { app } = await webhookTestApp({ env: ENV, clock: new FakeClock(START) });
  for (let failure = 0; failure < 30; failure += 1) {
    await forgedFrom(app, ATTACKER);
    await validFrom(app, ATTACKER);
  }
  expect((await forgedFrom(app, ATTACKER)).statusCode).toBe(429);
});

test('a failure that is not a bad signature does not count: 40 signed deliveries refused later are never throttled', async () => {
  const { app } = await webhookTestApp({ env: ENV, clock: new FakeClock(START) });
  const broken = '{"unterminated":';
  const codes = await statuses(40, () =>
    app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      headers: deliveryHeaders(broken),
      payload: broken,
      remoteAddress: ATTACKER,
    }),
  );
  expect(codes).toEqual(Array.from({ length: 40 }, () => 400));
  expect((await forgedFrom(app, ATTACKER)).statusCode).toBe(401);
});

test('the address is request.ip: with no trusted proxy a forwarded address is ignored, so it cannot be rotated', async () => {
  const { app } = await webhookTestApp({ env: ENV, clock: new FakeClock(START) });
  const codes = await statuses(31, (index) =>
    forgedFrom(app, ATTACKER, 0, { 'x-forwarded-for': `198.51.100.${index}` }),
  );
  expect(codes[30]).toBe(429);
  const genuine = await forgedFrom(app, GITHUB, 0, { 'x-forwarded-for': '198.51.100.250' });
  expect(genuine.statusCode).toBe(401);
});

test('behind a trusted proxy the address is the forwarded client: TRUST_PROXY decides which one counts', async () => {
  const { app } = await webhookTestApp({ env: { ...ENV, TRUST_PROXY: '1' }, clock: new FakeClock(START) });
  const proxy = '198.51.100.5';
  await statuses(31, () => forgedFrom(app, proxy, 0, { 'x-forwarded-for': ATTACKER }));
  const refused = await forgedFrom(app, proxy, 0, { 'x-forwarded-for': ATTACKER });
  const other = await forgedFrom(app, proxy, 0, { 'x-forwarded-for': GITHUB });
  expect([refused.statusCode, other.statusCode]).toEqual([429, 401]);
});

test('the address is never logged, wherever it came from, and no response carries it', async () => {
  const { app, logs } = await webhookTestApp({ env: { ...ENV, TRUST_PROXY: '1' }, clock: new FakeClock(START) });
  const proxy = '198.51.100.5';
  const responses = [
    ...(await Promise.all(
      Array.from({ length: 35 }, () => forgedFrom(app, proxy, 0, { 'x-forwarded-for': ATTACKER })),
    )),
    await forgedFrom(app, ATTACKER),
  ];
  const everything = `${logs.text()}\n${responses.map((response) => JSON.stringify([response.body, response.headers])).join('\n')}`;
  for (const address of [ATTACKER, proxy]) {
    expect(everything).not.toContain(address);
  }
  expect(logs.lines().filter((line) => line['msg'] === 'webhook.received').length).toBeGreaterThanOrEqual(35);
});
