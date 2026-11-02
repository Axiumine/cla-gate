// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import Fastify, { type FastifyInstance } from 'fastify';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { parseGithubId } from '../../../shared/github-id.ts';
import { Secret } from '../../config/secret.ts';
import { registerErrorHandlers } from './errors.ts';
import { CsrfRouteError, registerRequestGuards } from './request-guards.ts';

// The guard on a bare Fastify instance (E10-S03): its own contract, with no session store behind it. The caller is
// whatever a test hook says it is.

const ORIGIN = 'https://app.example.com';
const KEY = new Secret('test-session-secret-0123456789ab');

/** A Fastify instance with the guards. `login` false is an app whose login settings are missing: no session secret. */
function bare(login = true): FastifyInstance {
  const app = Fastify();
  registerErrorHandlers(app);
  registerRequestGuards(app, { publicBaseUrl: `${ORIGIN}/`, sessionSecret: login ? KEY : undefined });
  return app;
}

/** Makes every request of `app` carry a session, as the session hook of the real app would. */
function signedIn(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    request.auth = {
      user: { id: 1, githubId: parseGithubId(1), login: 'x', name: null, avatarUrl: null },
      sessionId: 1,
      // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- made-up value for the tests, not a credential
      csrfSecret: 'secret',
      expiresAt: new Date(0),
    };
    done();
  });
}

test('request.auth is declared and null until a session hook fills it', async () => {
  const app = bare();
  app.get('/who', (request) => ({ auth: request.auth }));
  expect((await app.inject('/who')).json()).toEqual({ auth: null });
});

test('PUBLIC_BASE_URL spelled with a trailing slash still allows the bare origin: the request gets as far as the token', async () => {
  const app = bare();
  signedIn(app);
  app.post('/thing', () => 'done');
  const response = await app.inject({ method: 'POST', url: '/thing', headers: { origin: ORIGIN } });
  expect(response.statusCode).toBe(403);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('csrf_invalid');
});

test('with no session secret no token is ever valid: a caller with a session is still 403 csrf_invalid', async () => {
  const app = bare(false);
  signedIn(app);
  app.post('/thing', () => 'done');
  const response = await app.inject({
    method: 'POST',
    url: '/thing',
    headers: { origin: ORIGIN, 'x-csrf-token': 'A'.repeat(43) },
  });
  expect(response.statusCode).toBe(403);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('csrf_invalid');
});

test('without login settings every state-changing request is refused: a wrong Origin is 403 and the right one is 401', async () => {
  const app = bare(false);
  app.post('/thing', () => 'done');
  const wrong = await app.inject({ method: 'POST', url: '/thing', headers: { origin: 'https://evil.example' } });
  const right = await app.inject({ method: 'POST', url: '/thing', headers: { origin: ORIGIN } });
  expect([wrong.statusCode, right.statusCode]).toEqual([403, 401]);
  expect(errorResponseSchema.parse(right.json()).error.code).toBe('unauthorized');
});

test('the webhook route, flagged exempt, needs no Origin, session or token; the same request elsewhere does', async () => {
  const app = bare();
  app.post('/webhooks/github', { config: { csrf: 'exempt' } }, () => 'delivered');
  app.post('/other', () => 'other');
  const hook = await app.inject({ method: 'POST', url: '/webhooks/github' });
  const withEvilOrigin = await app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: { origin: 'https://evil.example' },
  });
  const other = await app.inject({ method: 'POST', url: '/other' });
  expect([hook.body, withEvilOrigin.body]).toEqual(['delivered', 'delivered']);
  expect(other.statusCode).toBe(403);
});

test('the webhook route without the flag is guarded like any other', async () => {
  const app = bare();
  app.post('/webhooks/github', () => 'delivered');
  expect((await app.inject({ method: 'POST', url: '/webhooks/github' })).statusCode).toBe(403);
});

test.each([
  ['POST', '/api/rogue'],
  ['PUT', '/webhooks/github'],
  ['GET', '/healthz'],
  ['DELETE', '/api/auth/logout'],
] as const)('a %s route %s that sets config.csrf = exempt cannot be registered', (method, url) => {
  const app = bare();
  const register = () => app.route({ method, url, config: { csrf: 'exempt' }, handler: () => 'ok' });
  expect(register).toThrow(CsrfRouteError);
  expect(register).toThrow(`route ${method} ${url} sets config.csrf = 'exempt' but is not in CSRF_EXEMPT`);
});

test('a plugin that registers a flagged route under a prefix fails to load, naming the route', async () => {
  const app = bare();
  const load = app.register(
    // eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async; a throw in a callback-style plugin is not caught by avvio
    async (instance) => {
      instance.post('/hook', { config: { csrf: 'exempt' } }, () => 'ok');
    },
    { prefix: '/api/v1' },
  );
  await expect(load).rejects.toThrow('route POST /api/v1/hook sets config.csrf');
});

test('a route that sets the flag for GET and POST is refused for the method that is not listed', () => {
  const app = bare();
  const register = () =>
    app.route({ method: ['GET', 'POST'], url: '/webhooks/github', config: { csrf: 'exempt' }, handler: () => 'ok' });
  expect(register).toThrow("route GET /webhooks/github sets config.csrf = 'exempt'");
});
