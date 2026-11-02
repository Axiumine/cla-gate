// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import { expect, test } from 'vitest';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';

// Whose budget a request spends (E10-S08): the key is `request.ip`, which follows TRUST_PROXY. Every test sends login
// starts (20 a minute) from one socket, 127.0.0.1 unless it says otherwise, and reads the statuses.

type Headers = Readonly<Record<string, string>>;

/** One login start with `headers`, from `remoteAddress` when given. */
async function start(app: FastifyInstance, headers: Headers = {}, remoteAddress?: string): Promise<number> {
  const response = await app.inject({
    url: '/api/auth/login',
    headers,
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
  });
  return response.statusCode;
}

/** `count` login starts, each with the headers `headersOf` makes for its number. */
async function starts(
  app: FastifyInstance,
  count: number,
  headersOf: (n: number) => Headers = () => ({}),
): Promise<number[]> {
  const statuses: number[] = [];
  for (let n = 0; n < count; n++) {
    statuses.push(await start(app, headersOf(n)));
  }
  return statuses;
}

test('with TRUST_PROXY=false a spoofed X-Forwarded-For gives no fresh budget: the 21st start from one socket is limited', async () => {
  const { app } = await testApp({ env: AUTH_ENV });
  const statuses = await starts(app, 20, (n) => ({ 'x-forwarded-for': `198.51.100.${n + 1}` }));
  expect(new Set(statuses)).toEqual(new Set([302]));
  expect(await start(app, { 'x-forwarded-for': '203.0.113.200' })).toBe(429);
});

test('with TRUST_PROXY=false a spoofed Forwarded header gives no fresh budget either', async () => {
  const { app } = await testApp({ env: AUTH_ENV });
  await starts(app, 20, (n) => ({ forwarded: `for=198.51.100.${n + 1}` }));
  expect(await start(app, { forwarded: 'for=203.0.113.200' })).toBe(429);
});

test('with TRUST_PROXY=false two sockets have independent budgets', async () => {
  const { app } = await testApp({ env: AUTH_ENV });
  await starts(app, 20);
  expect(await start(app)).toBe(429);
  expect(await start(app, {}, '192.0.2.44')).toBe(302);
});

test('with TRUST_PROXY=1 two different forwarded clients have independent budgets', async () => {
  const { app } = await testApp({ env: { ...AUTH_ENV, TRUST_PROXY: '1' } });
  const first = { 'x-forwarded-for': '198.51.100.1' };
  const second = { 'x-forwarded-for': '198.51.100.2' };
  expect(new Set(await starts(app, 20, () => first))).toEqual(new Set([302]));
  expect(await start(app, first)).toBe(429);
  expect(new Set(await starts(app, 20, () => second))).toEqual(new Set([302]));
  expect(await start(app, second)).toBe(429);
});

test('with TRUST_PROXY=1 only the address the proxy appended counts: a client cannot rotate the part it wrote itself', async () => {
  const { app } = await testApp({ env: { ...AUTH_ENV, TRUST_PROXY: '1' } });
  const statuses = await starts(app, 20, (n) => ({ 'x-forwarded-for': `192.0.2.${n + 1}, 198.51.100.1` }));
  expect(new Set(statuses)).toEqual(new Set([302]));
  expect(await start(app, { 'x-forwarded-for': '192.0.2.250, 198.51.100.1' })).toBe(429);
  expect(await start(app, { 'x-forwarded-for': '198.51.100.1' })).toBe(429);
});

test('with a list of trusted proxies, a request from outside the list cannot choose its address', async () => {
  const { app } = await testApp({ env: { ...AUTH_ENV, TRUST_PROXY: '198.51.100.0/24' } });
  await starts(app, 20, (n) => ({ 'x-forwarded-for': `198.51.100.${n + 1}` }));
  expect(await start(app, { 'x-forwarded-for': '203.0.113.9' })).toBe(429);
  expect(await start(app, { 'x-forwarded-for': '203.0.113.9' }, '198.51.100.7')).toBe(302);
});

test('IPv6 clients are counted by their /64: a whole network cannot rotate its way to fresh budgets', async () => {
  const { app } = await testApp({ env: AUTH_ENV });
  for (let n = 1; n <= 20; n++) {
    await start(app, {}, `2001:db8:1:2::${n.toString(16)}`);
  }
  expect(await start(app, {}, '2001:db8:1:2:ffff::1')).toBe(429);
  expect(await start(app, {}, '2001:db8:1:3::1')).toBe(302);
});

test('an IPv4 address and its IPv4-mapped IPv6 form share one budget', async () => {
  const { app } = await testApp({ env: AUTH_ENV });
  const address = '192.0.2.44';
  for (let n = 0; n < 20; n++) {
    await start(app, {}, address);
  }
  expect(await start(app, {}, `::ffff:${address}`)).toBe(429);
});
