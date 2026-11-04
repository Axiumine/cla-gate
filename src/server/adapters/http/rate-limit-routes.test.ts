// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import Fastify, { type FastifyInstance } from 'fastify';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { registerErrorHandlers } from './errors.ts';
import {
  HOUR_MS,
  RATE_LIMIT_EXEMPT,
  RATE_LIMITS,
  RateLimitRouteError,
  rateLimitProblem,
  registerRateLimit,
  routeRateLimit,
  userRateLimit,
} from './rate-limit.ts';
import { postDelivery, SECRET_CURRENT, webhookTestApp } from './test-support.ts';

// The routes that may leave the rate limit (E10-S08), and the rules a route with a budget of its own follows.

async function bare(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandlers(app);
  await registerRateLimit(app, { trustProxy: false, clock: { now: () => new Date() } });
  return app;
}

test('the budgets are the ones of the story, spelled out here on purpose', () => {
  expect(RATE_LIMITS).toEqual({
    global: 600,
    login: 20,
    callback: 20,
    logout: 20,
    session: 120,
    signatureExport: 6,
    dataExport: 5,
    sign: 10,
  });
});

test('a budget lasts a minute unless the route names another window, and the budget of a person is checked after the guard', () => {
  expect(HOUR_MS).toBe(3_600_000);
  expect(routeRateLimit(5)).toEqual({ max: 5, timeWindow: 60_000, cache: 10_000 });
  expect(routeRateLimit(5, HOUR_MS)).toEqual({ max: 5, timeWindow: 3_600_000, cache: 10_000 });
  expect(userRateLimit(6)).toMatchObject({ max: 6, timeWindow: 60_000, cache: 10_000, hook: 'preHandler' });
  expect(userRateLimit(5, HOUR_MS)).toMatchObject({ max: 5, timeWindow: 3_600_000, cache: 10_000, hook: 'preHandler' });
});

test('the exempt set is exactly the webhook route, spelled out here on purpose', () => {
  expect(RATE_LIMIT_EXEMPT).toEqual(['POST /webhooks/github']);
});

test.each([
  ['the webhook route switched off', 'POST', '/webhooks/github', { rateLimit: false }],
  ['the webhook route in lower case', 'post', '/webhooks/github', { rateLimit: false }],
  ['a route with no config at all', 'GET', '/api/anything', undefined],
  ['a route with a config that says nothing of the limit', 'GET', '/api/anything', { csrf: 'exempt' }],
  ['a route whose limit is undefined', 'GET', '/api/anything', { rateLimit: undefined }],
  ['a GET route with a budget of its own', 'GET', '/api/auth/login', { rateLimit: routeRateLimit(20) }],
  ['a POST route with a budget of its own', 'POST', '/api/auth/logout', { rateLimit: routeRateLimit(20) }],
  ['a config that is not an object', 'GET', '/api/anything', 'rateLimit'],
])('%s is accepted at registration', (_label, method, url, config) => {
  expect(rateLimitProblem(method, url, config)).toBeUndefined();
});

test.each([
  ['another POST route', 'POST', '/api/anything', 'route POST /api/anything sets config.rateLimit = false'],
  ['a GET route', 'GET', '/webhooks/github', 'route GET /webhooks/github sets config.rateLimit = false'],
  ['another method of the webhook path', 'PUT', '/webhooks/github', 'route PUT /webhooks/github sets config.rateLimit'],
  [
    'the webhook path with a trailing slash',
    'POST',
    '/webhooks/github/',
    'route POST /webhooks/github/ sets config.rateLimit',
  ],
  ['the webhook path in another case', 'POST', '/Webhooks/github', 'route POST /Webhooks/github sets config.rateLimit'],
  ['a login route', 'GET', '/api/auth/login', 'route GET /api/auth/login sets config.rateLimit'],
])('%s cannot switch the limit off', (_label, method, url, message) => {
  expect(rateLimitProblem(method, url, { rateLimit: false })).toContain(message);
});

test('a route answering several methods is refused when any one of them is not on the list', () => {
  expect(rateLimitProblem(['POST'], '/webhooks/github', { rateLimit: false })).toBeUndefined();
  expect(rateLimitProblem(['POST', 'PUT'], '/webhooks/github', { rateLimit: false })).toContain(
    'route PUT /webhooks/github',
  );
});

test('a route with a budget of its own that answers HEAD is refused, naming the fix', () => {
  expect(rateLimitProblem('HEAD', '/api/auth/login', { rateLimit: routeRateLimit(20) })).toContain(
    'route HEAD /api/auth/login has a rate limit of its own',
  );
  expect(rateLimitProblem(['GET', 'head'], '/x', { rateLimit: routeRateLimit(20) })).toContain('exposeHeadRoute');
});

test.each([
  ['POST', '/api/rogue'],
  ['PUT', '/webhooks/github'],
  ['GET', '/healthz'],
  ['DELETE', '/api/auth/logout'],
] as const)('a %s route %s that sets config.rateLimit = false cannot be registered', async (method, url) => {
  const app = await bare();
  const register = () => app.route({ method, url, config: { rateLimit: false }, handler: () => 'ok' });
  expect(register).toThrow(RateLimitRouteError);
  expect(register).toThrow(`route ${method} ${url} sets config.rateLimit = false but is not in RATE_LIMIT_EXEMPT`);
});

test('a plugin that registers a route outside the limit under a prefix fails to load, naming the route', async () => {
  const app = await bare();
  const load = app.register(
    // eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async; a throw in a callback-style plugin is not caught by avvio
    async (instance) => {
      instance.post('/hook', { config: { rateLimit: false } }, () => 'ok');
    },
    { prefix: '/api/v1' },
  );
  await expect(load).rejects.toThrow('route POST /api/v1/hook sets config.rateLimit = false');
});

test('a GET route with a budget of its own is refused for its HEAD twin', async () => {
  const app = await bare();
  const register = () => app.get('/limited', { config: { rateLimit: routeRateLimit(5) } }, () => 'ok');
  expect(register).toThrow(RateLimitRouteError);
  const again = await bare();
  const registerAgain = () => again.get('/limited', { config: { rateLimit: routeRateLimit(5) } }, () => 'ok');
  expect(registerAgain).toThrow('route HEAD /limited has a rate limit of its own');
});

test('a GET route with a budget of its own is accepted when it gives its HEAD twin up', async () => {
  const app = await bare();
  const register = () =>
    app.get('/limited', { config: { rateLimit: routeRateLimit(5) }, exposeHeadRoute: false }, () => 'ok');
  expect(register).not.toThrow();
});

test('a limit that is neither false nor an object is refused by the plugin', async () => {
  const app = await bare();
  const register = () => app.get('/odd', { config: { rateLimit: true } }, () => 'ok');
  expect(register).toThrow('Unknown value for route rate-limit configuration');
});

test('the real webhook route spends no budget: 700 signed deliveries, no 429 and no ratelimit header', async () => {
  const { app } = await webhookTestApp({ env: { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT } });
  const ping = '{"zen":"Keep it logically awesome."}';
  let answered = 0;
  for (let sent = 0; sent < 700; sent++) {
    const response = await postDelivery(app, ping);
    answered += response.statusCode === 200 ? 1 : 0;
    if (sent === 0) {
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    }
  }
  expect(answered).toBe(700);
});

test('a webhook route left under the global limit would be limited like any other: the 601st delivery gets a 429', async () => {
  const app = await bare();
  app.post(WEBHOOK_PATH, () => 'delivered');
  let delivered = 0;
  for (let sent = 0; sent < 600; sent++) {
    delivered += (await app.inject({ method: 'POST', url: WEBHOOK_PATH })).statusCode === 200 ? 1 : 0;
  }
  const response = await app.inject({ method: 'POST', url: WEBHOOK_PATH });
  expect(delivered).toBe(600);
  expect(response.statusCode).toBe(429);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('too_many_requests');
});
