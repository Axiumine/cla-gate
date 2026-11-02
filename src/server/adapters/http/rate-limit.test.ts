// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import { expect, onTestFinished, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';
import { routeRateLimit } from './rate-limit.ts';

// The budgets of the rate limit (E10-S08): 600 requests a minute per client address, and the overrides of the login
// routes. The budgets are spelled out here on purpose: the tests assert the numbers of the story, not the constants.

interface Probe {
  readonly method: 'GET' | 'POST';
  readonly url: string;
}

/** Sends `count` requests in a row and returns their statuses. */
async function send(app: FastifyInstance, probe: Probe, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let sent = 0; sent < count; sent++) {
    statuses.push((await app.inject(probe)).statusCode);
  }
  return statuses;
}

const LOGIN: Probe = { method: 'GET', url: '/api/auth/login' };

test.each([
  ['GET /api/auth/login', LOGIN, 20],
  ['GET /api/auth/callback', { method: 'GET', url: '/api/auth/callback' }, 20],
  ['POST /api/auth/logout', { method: 'POST', url: '/api/auth/logout' }, 20],
  ['GET /api/auth/session', { method: 'GET', url: '/api/auth/session' }, 120],
  ['GET /healthz (the global budget)', { method: 'GET', url: '/healthz' }, 600],
] as const)('%s allows %i requests a minute from one client and limits the next', async (_name, probe, budget) => {
  const { app } = await testApp({ env: AUTH_ENV });
  const allowed = await send(app, probe, budget);
  expect(allowed).not.toContain(429);
  const limited = await app.inject(probe);
  expect(limited.statusCode).toBe(429);
  expect(limited.headers['x-ratelimit-limit']).toBe(String(budget));
});

test('the 429 has the standard error body, a retry-after and the x-ratelimit headers, and logs no address', async () => {
  const { app, logs } = await testApp({ env: AUTH_ENV });
  await send(app, LOGIN, 20);
  const response = await app.inject({ ...LOGIN, headers: { 'x-request-id': 'trace-429' } });
  expect(response.statusCode).toBe(429);
  expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(errorResponseSchema.parse(response.json())).toEqual({
    error: { code: 'too_many_requests', message: 'Too Many Requests', requestId: response.headers['x-request-id'] },
  });
  expect(response.headers['retry-after']).toBe('60');
  expect(response.headers['x-ratelimit-limit']).toBe('20');
  expect(response.headers['x-ratelimit-remaining']).toBe('0');
  expect(response.headers['x-ratelimit-reset']).toBe('60');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).not.toMatch(/127\.0\.0\.1|Rate limit exceeded/);
  expect(logs.lines().find((line) => line['msg'] === 'request rejected')).toMatchObject({
    statusCode: 429,
    code: 'too_many_requests',
  });
  expect(logs.text()).not.toContain('127.0.0.1');
});

test('an allowed response carries x-ratelimit-limit, -remaining and -reset, and no retry-after', async () => {
  const { app } = await testApp();
  const first = await app.inject('/healthz');
  const second = await app.inject('/healthz');
  expect(first.headers['x-ratelimit-limit']).toBe('600');
  expect(first.headers['x-ratelimit-remaining']).toBe('599');
  expect(second.headers['x-ratelimit-remaining']).toBe('598');
  expect(first.headers['x-ratelimit-reset']).toBe('60');
  expect(first.headers['retry-after']).toBeUndefined();
});

test('a route with its own budget does not spend the global one, and the other way round', async () => {
  const { app } = await testApp({ env: AUTH_ENV });
  await send(app, LOGIN, 21);
  const health = await app.inject('/healthz');
  expect(health.statusCode).toBe(200);
  expect(health.headers['x-ratelimit-remaining']).toBe('599');
  const session = await app.inject('/api/auth/session');
  expect(session.headers['x-ratelimit-remaining']).toBe('119');
});

test('the budget is a minute: it is full again when the window ends, not before', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
  const { app } = await testApp({ env: AUTH_ENV });
  await send(app, LOGIN, 20);
  vi.setSystemTime(new Date('2026-11-02T10:00:30.000Z'));
  const half = await app.inject(LOGIN);
  expect([half.statusCode, half.headers['retry-after']]).toEqual([429, '30']);
  vi.setSystemTime(new Date('2026-11-02T10:00:59.999Z'));
  expect((await app.inject(LOGIN)).statusCode).toBe(429);
  vi.setSystemTime(new Date('2026-11-02T10:01:00.000Z'));
  const fresh = await app.inject(LOGIN);
  expect([fresh.statusCode, fresh.headers['x-ratelimit-remaining']]).toEqual([302, '19']);
});

test('a request that no route answers spends the global budget, and the 601st is limited', async () => {
  const { app } = await testApp();
  const unmatched: Probe = { method: 'GET', url: '/no-such-page' };
  const allowed = await send(app, unmatched, 600);
  expect(new Set(allowed)).toEqual(new Set([404]));
  const limited = await app.inject(unmatched);
  expect(limited.statusCode).toBe(429);
  expect(errorResponseSchema.parse(limited.json()).error.code).toBe('too_many_requests');
  expect((await app.inject('/healthz')).statusCode).toBe(429);
});

test('a request that no route answers never reaches the session lookup, within its budget or over it', async () => {
  const { app, queries } = await authWorld();
  const before = queries.length;
  const forged = { cookie: `${COOKIE_NAME}=${'A'.repeat(43)}` };
  for (let sent = 0; sent < 600; sent++) {
    expect((await app.inject({ url: '/no-such-page', headers: forged })).statusCode).toBe(404);
  }
  const limited = await app.inject({ url: '/no-such-page', headers: forged });
  expect(limited.statusCode).toBe(429);
  expect(queries).toHaveLength(before);
});

test('a route can key its budget on something else than the address, through config.rateLimit', async () => {
  const { app } = await testApp();
  app.get(
    '/by-user',
    {
      config: {
        access: 'public',
        rateLimit: { ...routeRateLimit(2), keyGenerator: (request) => String(request.headers['x-user'] ?? '') },
      },
      exposeHeadRoute: false,
    },
    () => 'ok',
  );
  const as = (user: string) => app.inject({ url: '/by-user', headers: { 'x-user': user } });
  expect([(await as('ada')).statusCode, (await as('ada')).statusCode, (await as('ada')).statusCode]).toEqual([
    200, 200, 429,
  ]);
  expect((await as('grace')).statusCode).toBe(200);
});

test('a HEAD request cannot be used to double the budget of a route: there is no HEAD route to spend', async () => {
  const { app } = await testApp({ env: AUTH_ENV });
  await send(app, LOGIN, 20);
  const head = await app.inject({ method: 'HEAD', url: '/api/auth/login' });
  expect(head.statusCode).toBe(404);
});
