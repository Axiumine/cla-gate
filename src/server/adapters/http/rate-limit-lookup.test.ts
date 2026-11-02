// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';
import { routeRateLimit } from './rate-limit.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT } from './test-support.ts';

// The session lookup is a database query, so it must sit behind the budget of the client address (E10-S08): a request
// that is over its budget is refused before it costs a query, whatever route it was sent to. The budgets are spelled out
// here on purpose: the tests assert the numbers of the story, not the constants.

/** A cookie that has the shape of a session id and names no session: it reaches the lookup and finds nothing. */
const FORGED = { cookie: `${COOKIE_NAME}=${'A'.repeat(43)}` };

test.each([
  ['GET /api/auth/login', { method: 'GET', url: '/api/auth/login' }, 20],
  ['GET /api/auth/callback', { method: 'GET', url: '/api/auth/callback' }, 20],
  ['POST /api/auth/logout', { method: 'POST', url: '/api/auth/logout' }, 20],
  ['GET /api/auth/session', { method: 'GET', url: '/api/auth/session' }, 120],
  ['GET /healthz (the global budget)', { method: 'GET', url: '/healthz' }, 600],
] as const)('a request over the budget of %s is refused before the session lookup', async (_name, probe, budget) => {
  const { app, queries } = await authWorld();
  for (let sent = 0; sent < budget; sent++) {
    expect((await app.inject({ ...probe, headers: FORGED })).statusCode).not.toBe(429);
  }
  expect(queries.length, 'the lookup runs while the client is within its budget').toBeGreaterThanOrEqual(budget);
  const before = queries.length;
  for (let extra = 0; extra < 3; extra++) {
    const limited = await app.inject({ ...probe, headers: FORGED });
    expect(limited.statusCode).toBe(429);
  }
  expect(queries).toHaveLength(before);
});

test('the webhook route, which is outside the rate limit, never runs the session lookup for a forged cookie', async () => {
  const { app, queries } = await authWorld({ GITHUB_WEBHOOK_SECRET: SECRET_CURRENT });
  const ping = '{"zen":"Keep it logically awesome."}';
  const before = queries.length;
  for (let sent = 0; sent < 5; sent++) {
    const response = await postDelivery(app, ping, deliveryHeaders(ping, { headers: FORGED }));
    expect([response.statusCode, response.json()]).toEqual([200, { status: 'pong' }]);
  }
  expect(queries).toHaveLength(before);
});

test('a route that keys its budget on the signed-in user sets hook preHandler and sees the user, not the address', async () => {
  const { app, login } = await authWorld();
  const seen: unknown[] = [];
  app.get(
    '/by-user',
    {
      config: {
        rateLimit: {
          ...routeRateLimit(2),
          hook: 'preHandler',
          keyGenerator: (request) => {
            seen.push(request.auth?.user.githubId);
            return String(request.auth?.user.githubId);
          },
        },
      },
      exposeHeadRoute: false,
    },
    () => 'ok',
  );
  const ada = await login(1001);
  const grace = await login(2002);
  const as = (person: { readonly cookie: string }) =>
    app.inject({ url: '/by-user', headers: { cookie: person.cookie } });
  const statuses = [await as(ada), await as(ada), await as(ada), await as(grace)].map(
    (response) => response.statusCode,
  );
  expect(statuses).toEqual([200, 200, 429, 200]);
  expect(seen).toEqual([1001, 1001, 1001, 2002]);
});
