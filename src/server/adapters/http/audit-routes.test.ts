// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS } from '../../../shared/audit.ts';
import { PUBLIC_ROUTE, testApp } from '../../test-support.ts';
import { AUDIT_EXEMPT_REASONS, auditProblem, UnauditedRouteError } from './audit-routes.ts';
import { authWorld } from './auth-fixture/test-support.ts';

const AUDIT = { audit: 'repository.enabled' };

test.each([
  ['a GET under /api', 'GET', '/api/things', undefined],
  ['a HEAD under /api', 'HEAD', '/api/things', undefined],
  ['an OPTIONS under /api', 'OPTIONS', '/api/things', undefined],
  ['a POST outside /api', 'POST', '/webhooks/github', undefined],
  ['a POST to a path that only starts with the letters api', 'POST', '/apiary', undefined],
  ['a POST to /health', 'POST', '/healthz', undefined],
  ['a POST to a static path that is a prefix of api', 'POST', '/ap/things', undefined],
  ['a POST whose wildcard follows a static first segment that cannot be api', 'POST', '/health*', undefined],
  ['a POST whose parameter follows text that cannot be the start of api', 'POST', '/x:id/things', undefined],
  ['a POST to api with more letters before the wildcard', 'POST', '/apix*', undefined],
  ['a POST that declares an audit action', 'POST', '/api/things', AUDIT],
  ['a PUT that declares an audit action', 'PUT', '/api/things/:id', AUDIT],
  ['a PATCH that declares an audit action', 'PATCH', '/api/things/:id', AUDIT],
  ['a DELETE that declares an audit action', 'DELETE', '/api/things/:id', AUDIT],
  ['a POST exempt as webhook', 'POST', '/api/hooks', { auditExempt: 'webhook' }],
  ['a POST exempt as session', 'POST', '/api/logout', { auditExempt: 'session' }],
  ['a POST exempt as setup', 'POST', '/api/setup/unlock', { auditExempt: 'setup' }],
  ['a declaration beside unrelated route config', 'POST', '/api/things', { ...AUDIT, rateLimit: { max: 3 } }],
  ['a lower-case method name', 'post', '/api/things', AUDIT],
  ['a method list where every method is declared', ['POST', 'PUT'], '/api/things', AUDIT],
])('%s is fine', (_name, method, url, config) => {
  expect(auditProblem(method, url, config)).toBeUndefined();
});

test.each([
  ['a POST with no config', 'POST', '/api/things', undefined],
  ['a PUT with an empty config', 'PUT', '/api/things/:id', {}],
  ['a PATCH with unrelated config', 'PATCH', '/api/things/:id', { rateLimit: { max: 3 } }],
  ['a DELETE with no config', 'DELETE', '/api/things/:id', undefined],
  ['the /api root itself', 'POST', '/api', undefined],
  ['a trailing-slash route', 'POST', '/api/', {}],
  ['an upper-case path', 'POST', '/API/things', {}],
  ['a catch-all, which would also answer /api', 'POST', '/*', {}],
  ['a bare wildcard', 'POST', '*', {}],
  ['a wildcard glued to api, which would answer /api/x', 'POST', '/api*', {}],
  ['a wildcard glued to ap, which would answer /api/x', 'POST', '/ap*', {}],
  ['a wildcard glued to a, which would answer /api/x', 'POST', '/a*', {}],
  ['a parameter glued to a, which would answer /api/x', 'PUT', '/a:id/x', {}],
  ['a parameter glued to ap, which would answer /api/x', 'PATCH', '/ap:id/x', {}],
  ['a parameter glued to api, which would answer /api/x', 'DELETE', '/api:id/x', {}],
  ['a wildcard glued to API in capitals', 'POST', '/AP*', {}],
  ['a regex first segment', 'POST', '/(.*)', {}],
  ['a route that starts with a parameter, which would also answer /api', 'DELETE', '/:tenant/things', {}],
  ['a method list with one mutating method', ['GET', 'POST'], '/api/things', {}],
  ['null config', 'POST', '/api/things', null],
])('%s must declare an audit action or an exemption', (_name, method, url, config) => {
  const methods = [method].flat().map((name) => name.toUpperCase());
  expect(auditProblem(method, url, config)).toBe(
    `route ${methods.join('|')} ${url} must declare config.audit (an AUDIT_ACTIONS member) or config.auditExempt (a reason)`,
  );
});

test.each([
  ['an action that is not in the closed set', { audit: 'made.up' }],
  ['a text that is not an action', { audit: 'alice@example.com' }],
  ['an exemption reason outside the closed list', { auditExempt: 'because' }],
  ['an exemption reason that is empty', { auditExempt: '' }],
  ['a config that is not an object', 'audit'],
])('%s is refused', (_name, config) => {
  expect(auditProblem('POST', '/api/things', config)).toBe(
    'route POST /api/things declares a config.audit or config.auditExempt that is not in the closed list',
  );
});

test('declaring both an audit action and an exemption is ambiguous and refused', () => {
  expect(auditProblem('POST', '/api/things', { ...AUDIT, auditExempt: 'session' })).toBe(
    'route POST /api/things declares both config.audit and config.auditExempt; declare one',
  );
});

test('the exemption reasons are exactly webhook, session and setup', () => {
  expect([...AUDIT_EXEMPT_REASONS]).toEqual(['webhook', 'session', 'setup']);
  expect(AUDIT_ACTIONS).toContain(AUDIT.audit);
});

test('the application as built has no unaudited mutating route under /api', async () => {
  const { app } = await testApp();
  await app.ready();
  expect((await app.inject('/healthz')).statusCode).toBe(200);
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
  'registering a %s route under /api without a declaration throws',
  async (method) => {
    const { app } = await testApp();
    const register = () => app.route({ method, url: `/api/${method}`, handler: () => 'ok' });
    expect(register).toThrow(UnauditedRouteError);
    expect(register).toThrow(`route ${method} /api/${method} must declare config.audit`);
  },
);

test('a plugin that registers an unaudited route under a prefix fails to load, naming the route', async () => {
  const { app } = await testApp();
  const load = app.register(
    // eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async; a throw in a callback-style plugin is not caught by avvio
    async (instance) => {
      instance.post('/items', () => 'ok');
    },
    { prefix: '/api/v1' },
  );
  await expect(load).rejects.toThrow('route POST /api/v1/items must declare config.audit');
});

test('a route that declares config.audit or config.auditExempt registers and answers', async () => {
  const { app, login } = await authWorld();
  app.post('/api/audited', { config: { access: 'public', audit: 'repository.enabled' } }, () => 'audited');
  app.delete('/api/exempt', { config: { access: 'public', auditExempt: 'session' } }, () => 'exempt');
  app.post('/outside', PUBLIC_ROUTE, () => 'outside');
  app.get('/api/read', PUBLIC_ROUTE, () => 'read');
  const { headers } = await login(1001);
  const answers = await Promise.all([
    app.inject({ method: 'POST', url: '/api/audited', headers }),
    app.inject({ method: 'DELETE', url: '/api/exempt', headers }),
    app.inject({ method: 'POST', url: '/outside', headers }),
    app.inject('/api/read'),
  ]);
  expect(answers.map((answer) => answer.body)).toEqual(['audited', 'exempt', 'outside', 'read']);
});

test('a route registered for several methods is checked for the mutating ones', async () => {
  const { app } = await testApp();
  const register = () => app.route({ method: ['GET', 'PUT'], url: '/api/both', handler: () => 'ok' });
  expect(register).toThrow('route GET|PUT /api/both must declare config.audit');
});

test.each(['/ap*', '/a*', '/api*', '/a:id/x', '/ap:id/x'])(
  'registering a POST route %s, which would answer /api/x, throws without a declaration',
  async (url) => {
    const { app } = await testApp();
    expect(() => app.post(url, () => 'ok')).toThrow(`route POST ${url} must declare config.audit`);
  },
);

test('a route with a static first segment that cannot be api registers without a declaration', async () => {
  const { app, login } = await authWorld();
  app.post('/apix*', PUBLIC_ROUTE, () => 'apix');
  const { headers } = await login(1001);
  expect((await app.inject({ method: 'POST', url: '/apix/y', headers })).body).toBe('apix');
});
