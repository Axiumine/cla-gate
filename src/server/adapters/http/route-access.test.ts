// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { PUBLIC_ROUTE, testApp } from '../../test-support.ts';
import { RouteAccessError } from './route-access.ts';
import { declaredAccess, PUBLIC_ROUTES, WEBHOOK_ROUTES } from './route-access-model.ts';
import { accessProblem } from './route-access-problems.ts';
import { tenantAccess } from './tenant-access.ts';

// The access declarations (E11-S01): what a route may declare, what is refused, and that an app with a route that declares
// nothing, or something wrong, does not become ready. The route table of the real application is in route-access-table.test.ts.

const READ = tenantAccess({ mode: 'read', resolve: () => Promise.resolve(null) });
const WRITE = tenantAccess({ mode: 'write', resolve: () => Promise.resolve(null) });

/** `accessProblem` for a route written as `METHOD path`. */
function problemOf(route: string, access: unknown): string | undefined {
  const [method = '', url = ''] = route.split(' ');
  return accessProblem(method, url, access);
}

test.each([
  ['a public route', 'GET /healthz', 'public'],
  ['an authenticated route', 'GET /api/me/signatures', 'authenticated'],
  ['an operator route', 'GET /api/operator/installations', 'operator'],
  ['the webhook route', 'POST /webhooks/github', 'webhook'],
  ['a tenant read route', 'GET /api/installations/:installationId/signatures', READ],
  ['a tenant write route', 'POST /api/installations/:installationId/signatures/:signatureId/revoke', WRITE],
  ['a tenant read route that answers a safe method other than GET', 'OPTIONS /api/x/:installationId', READ],
  ['a tenant write route that only reads', 'GET /api/installations/:installationId/export', WRITE],
  [
    'an authenticated route keyed by the GitHub repository id, which resolves its tenant itself',
    'GET /api/sign/:githubRepoId',
    'authenticated',
  ],
  [
    'an authenticated route whose parameter only starts like a tenant one',
    'GET /api/x/:installationIdentifier',
    'authenticated',
  ],
])('%s is fine', (_name, route, access) => {
  expect(problemOf(route, access)).toBeUndefined();
});

test.each([
  ['nothing', 'GET /api/things', undefined],
  ['null', 'GET /api/things', null],
  ['a kind that does not exist', 'GET /api/things', 'admin'],
  ['a kind in capitals', 'GET /api/things', 'PUBLIC'],
  ['a number', 'GET /api/things', 1],
  ['an empty object', 'GET /api/things', {}],
  ['a kind spelled as an object', 'GET /api/things', { kind: 'public' }],
  ['a list of kinds', 'GET /api/things', ['public']],
])('%s is refused as no valid declaration', (_name, route, access) => {
  const message = `route ${route} declares a config.access that is not one of public, authenticated, webhook, operator, tenant`;
  expect(problemOf(route, access)).toBe(access === undefined ? `route ${route} declares no config.access` : message);
});

test.each([
  ['the bare word', 'GET /api/things', 'tenant'],
  ['a tenant object with no mode', 'GET /api/things', { kind: 'tenant', resolve: READ.resolve }],
  [
    'a tenant object with a mode that does not exist',
    'GET /api/things',
    { kind: 'tenant', mode: 'rw', resolve: READ.resolve },
  ],
  [
    'a tenant object with a mode in capitals',
    'POST /api/things',
    { kind: 'tenant', mode: 'WRITE', resolve: READ.resolve },
  ],
  [
    'a tenant object with a mode that is not a text',
    'GET /api/things',
    { kind: 'tenant', mode: 1, resolve: READ.resolve },
  ],
  ['a tenant object with a mode and no resolver', 'GET /api/things', { kind: 'tenant', mode: 'read' }],
  [
    'a tenant object whose resolver is not a function',
    'GET /api/things',
    { kind: 'tenant', mode: 'read', resolve: 'x' },
  ],
  ['a tenant object with neither', 'GET /api/things', { kind: 'tenant' }],
])(
  'a tenant route declared as %s must say whether it reads or writes, and how its tenant is found',
  (_name, route, access) => {
    expect(problemOf(route, access)).toBe(
      `route ${route} is a tenant route and must declare its mode, 'read' or 'write', and its resolver (tenantAccess)`,
    );
  },
);

test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
  'a tenant route that changes data with %s must be write, not read',
  (method) => {
    const route = `${method} /api/installations/:installationId/things`;
    expect(problemOf(route, READ)).toBe(
      `route ${route} is a tenant route that changes data, so its mode must be 'write'`,
    );
    expect(problemOf(route, WRITE)).toBeUndefined();
  },
);

test.each([
  ['a different path', 'POST /webhooks/other'],
  ['a different method', 'GET /webhooks/github'],
  ['a path with another case', 'POST /Webhooks/github'],
  ['a trailing slash', 'POST /webhooks/github/'],
])('only the webhook route may be webhook: %s is refused', (_name, route) => {
  expect(problemOf(route, 'webhook')).toBe(
    `route ${route} declares config.access 'webhook' but is not in WEBHOOK_ROUTES`,
  );
});

const TENANT_PARAMETER_ROUTES = [
  ['installationId', 'GET /api/installations/:installationId/signatures'],
  ['repositoryId', 'GET /api/repositories/:repositoryId'],
  ['documentId', 'POST /api/documents/:documentId/versions'],
  ['signatureId', 'POST /api/signatures/:signatureId/revoke'],
  ['entryId', 'DELETE /api/allowlist/:entryId'],
  ['installationId (the path continues)', 'GET /api/installations/:installationId'],
  ['InstallationId (another case)', 'GET /api/installations/:InstallationId'],
  ['installationId with a pattern', 'GET /api/installations/:installationId(^\\d+$)/x'],
  ['installationId next to another parameter', 'GET /api/x/:installationId-:other'],
  ['repositoryId in the middle of a path', 'GET /api/x/:other/:repositoryId/y'],
] as const;

test.each(TENANT_PARAMETER_ROUTES)('an authenticated route with the tenant parameter :%s is refused', (name, route) => {
  const parameter = `:${name.split(' ')[0]}`;
  expect(problemOf(route, 'authenticated')).toBe(
    `route ${route} is authenticated but its path has the tenant parameter ${parameter}; declare it as a tenant route`,
  );
});

// An operator sees the list of installations and nothing inside one (E11-S08), and a public route has no viewer at all: a
// tenant parameter on either is a tenant route that forgot its guard, so it does not start.
test.each(TENANT_PARAMETER_ROUTES)('an operator route with the tenant parameter :%s is refused', (name, route) => {
  const parameter = `:${name.split(' ')[0]}`;
  expect(problemOf(route, 'operator')).toBe(
    `route ${route} is operator but its path has the tenant parameter ${parameter}; declare it as a tenant route`,
  );
});

test.each(TENANT_PARAMETER_ROUTES)('a public route with the tenant parameter :%s is refused', (name, route) => {
  const parameter = `:${name.split(' ')[0]}`;
  expect(problemOf(route, 'public')).toBe(
    `route ${route} is public but its path has the tenant parameter ${parameter}; declare it as a tenant route`,
  );
});

test.each(['public', 'operator'] as const)(
  'a %s route whose parameter only starts like a tenant one is fine',
  (kind) => {
    expect(problemOf('GET /api/x/:installationIdentifier', kind)).toBeUndefined();
    expect(problemOf('GET /api/x/:githubRepoId', kind)).toBeUndefined();
  },
);

test('the same paths are fine as tenant routes: that is where the tenant parameters belong', () => {
  expect(problemOf('GET /api/installations/:installationId/signatures', READ)).toBeUndefined();
  expect(problemOf('DELETE /api/allowlist/:entryId', WRITE)).toBeUndefined();
});

test.each([
  ['public', 'public'],
  ['authenticated', 'authenticated'],
  ['webhook', 'webhook'],
  ['operator', 'operator'],
  ['a tenant read route', READ],
  ['a tenant write route', WRITE],
])('declaredAccess reads %s as it was declared', (_name, access) => {
  expect(declaredAccess(access)).toEqual(access);
});

test.each([
  [undefined],
  [null],
  ['tenant'],
  ['Public'],
  [{ kind: 'tenant' }],
  [{ kind: 'tenant', mode: 'x', resolve: READ.resolve }],
  [{ kind: 'tenant', mode: 'read' }],
  [7],
])('declaredAccess reads %j as no declaration', (access) => {
  expect(declaredAccess(access)).toBeUndefined();
});

test('the constants are the routes of the story, spelled out here on purpose', () => {
  expect(PUBLIC_ROUTES).toEqual([
    'GET /healthz',
    'GET /readyz',
    'GET /api/auth/login',
    'GET /api/auth/callback',
    'GET /api/meta',
    'GET /api/setup/status',
    'POST /api/setup/unlock',
    'POST /api/setup/manifest',
    'GET /api/setup/session',
    'POST /api/setup/convert',
    'GET /*',
    'HEAD /*',
  ]);
  expect(WEBHOOK_ROUTES).toEqual(['POST /webhooks/github']);
});

test('the error names every offending route, one per line, and its name is RouteAccessError', () => {
  const error = new RouteAccessError([
    'route GET /a declares no config.access',
    'route POST /b declares no config.access',
  ]);
  expect(error.name).toBe('RouteAccessError');
  expect(error.message).toBe(
    '2 route(s) break the access declarations:\nroute GET /a declares no config.access\nroute POST /b declares no config.access',
  );
});

test('the app becomes ready with the routes it registers itself, and the not-found handler needs no declaration', async () => {
  const { app } = await testApp();
  await app.ready();
  const unknown = await app.inject('/nothing-answers-here');
  expect(unknown.statusCode).toBe(404);
  expect(app.routeAccess.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
    'GET /healthz',
    'GET /readyz',
    'GET /api/operator/installations',
    'POST /api/installations/:installationId/documents',
    'GET /api/installations/:installationId/documents',
    'GET /api/installations/:installationId/repositories/:repositoryId/documents',
    'GET /api/installations/:installationId/documents/:documentId',
    'PATCH /api/installations/:installationId/documents/:documentId',
    'GET /api/installations/:installationId/documents/:documentId/draft',
    'PUT /api/installations/:installationId/documents/:documentId/draft',
    'DELETE /api/installations/:installationId/documents/:documentId/draft',
    'POST /api/installations/:installationId/documents/:documentId/versions',
    'GET /api/installations/:installationId/documents/:documentId/versions',
    'GET /api/installations/:installationId/documents/:documentId/versions/:versionId',
    'GET /api/installations',
    'GET /api/installations/:installationId/repositories',
    'GET /api/installations/:installationId/signatures',
    'POST /api/installations/:installationId/signatures/:signatureId/revoke',
    'GET /api/installations/:installationId/documents/:documentId/invalidation-preview',
    'POST /api/installations/:installationId/documents/:documentId/invalidations',
    'PUT /api/repositories/:repositoryId/cla-document',
    'POST /api/repositories/:repositoryId/enable',
    'POST /api/repositories/:repositoryId/disable',
    'POST /api/installations/:installationId/allowlist-entries',
    'POST /api/repositories/:repositoryId/allowlist-entries',
    'GET /api/installations/:installationId/allowlist-entries',
    'GET /api/repositories/:repositoryId/allowlist-entries',
    'DELETE /api/installations/:installationId/allowlist-entries/:entryId',
    'POST /api/repositories/:repositoryId/commit-overrides',
    'GET /api/repositories/:repositoryId/commit-overrides',
    'DELETE /api/repositories/:repositoryId/commit-overrides/:overrideId',
    'GET /api/meta',
    'GET /api/setup/status',
    'GET /api/installations/:installationId/audit-log',
    'GET /api/installations/:installationId/documents/:documentId/signatures.csv',
    'GET /api/installations/:installationId/erasure-preview',
    'POST /api/installations/:installationId/erasures',
    'GET /api/me/export',
    'GET /api/sign/:githubRepoId',
    'POST /api/sign',
    'GET /api/me/signatures',
    'POST /webhooks/github',
  ]);
});

test('a route that declares no access keeps the app from becoming ready, and the error names it', async () => {
  const { app } = await testApp();
  app.get('/undeclared', () => 'x');
  await expect(app.ready()).rejects.toThrow(RouteAccessError);
  await expect(app.ready()).rejects.toThrow('route GET /undeclared declares no config.access');
});

test('the error names every undeclared route, from plugins and nested prefixes as well, in one message', async () => {
  const { app } = await testApp();
  app.get('/first', () => 'x');
  app.get('/declared', PUBLIC_ROUTE, () => 'x');
  await app.register(
    // eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async; a throw in a callback-style plugin is not caught by avvio
    async (instance) => {
      instance.post('/second', () => 'x');
      instance.register(
        // eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins are async; a throw in a callback-style plugin is not caught by avvio
        async (inner) => {
          // @ts-expect-error -- a made-up kind: the types refuse it, and the check when the app becomes ready must too
          inner.delete('/third', { config: { access: 'admin' } }, () => 'x');
        },
        { prefix: '/deep' },
      );
    },
    { prefix: '/plugin' },
  );
  const failure = await app.ready().then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(RouteAccessError);
  const message = failure instanceof Error ? failure.message : '';
  expect(message).toContain('route GET /first declares no config.access');
  expect(message).toContain('route POST /plugin/second declares no config.access');
  expect(message).toContain('route DELETE /plugin/deep/third declares a config.access that is not one of');
  expect(message).not.toContain('/declared');
  expect(message.split('\n')).toHaveLength(4);
});

test('a route registered for several methods is checked for each of them', async () => {
  const { app } = await testApp();
  app.route({ method: ['GET', 'post'], url: '/both', handler: () => 'x' });
  await expect(app.ready()).rejects.toThrow(
    'route GET /both declares no config.access\nroute POST /both declares no config.access',
  );
});

test('the HEAD route Fastify adds beside a GET route is not a second entry, so an undeclared GET is named once', async () => {
  const { app } = await testApp();
  app.get('/twin', () => 'x');
  await expect(app.ready()).rejects.toThrow(
    '1 route(s) break the access declarations:\nroute GET /twin declares no config.access',
  );
});

test('a declared GET route has no HEAD entry in the table, and a HEAD route of its own has one', async () => {
  const { app } = await testApp();
  app.get('/twin', PUBLIC_ROUTE, () => 'x');
  app.route({ method: 'HEAD', url: '/head-only', ...PUBLIC_ROUTE, handler: () => 'x' });
  await app.ready();
  const names = app.routeAccess.map((entry) => `${entry.method} ${entry.url}`);
  expect(names).toContain('GET /twin');
  expect(names).not.toContain('HEAD /twin');
  expect(names).toContain('HEAD /head-only');
});

test('a HEAD route is the twin of a GET route only for the same path and the same declaration, and only a HEAD route can be one', async () => {
  const { app } = await testApp();
  const alone = { ...PUBLIC_ROUTE, exposeHeadRoute: false };
  app.get('/a', alone, () => 'x');
  app.route({ method: 'HEAD', url: '/a', config: { access: 'authenticated' }, handler: () => 'x' });
  app.get('/b', alone, () => 'x');
  app.route({ method: 'HEAD', url: '/c', ...PUBLIC_ROUTE, handler: () => 'x' });
  app.get('/d', PUBLIC_ROUTE, () => 'x');
  app.post('/d', PUBLIC_ROUTE, () => 'x');
  app.post('/e', PUBLIC_ROUTE, () => 'x');
  app.route({ method: 'HEAD', url: '/e', ...PUBLIC_ROUTE, handler: () => 'x' });
  await app.ready();
  const names = app.routeAccess.map((entry) => `${entry.method} ${entry.url}`);
  expect(names).toEqual(expect.arrayContaining(['HEAD /a', 'HEAD /c', 'POST /d', 'HEAD /e']));
  expect(names).not.toContain('HEAD /d');
});

test('a HEAD route with no declaration, beside a GET route that has one, is its own entry and is checked', async () => {
  const { app } = await testApp();
  app.route({ method: 'HEAD', url: '/mixed', handler: () => 'x' });
  app.get('/mixed', { ...PUBLIC_ROUTE, exposeHeadRoute: false }, () => 'x');
  await expect(app.ready()).rejects.toThrow('route HEAD /mixed declares no config.access');
});

test('a webhook declaration on any other route keeps the app from becoming ready', async () => {
  const { app } = await testApp();
  app.post('/not-the-webhook', { config: { access: 'webhook' } }, () => 'x');
  await expect(app.ready()).rejects.toThrow(
    "route POST /not-the-webhook declares config.access 'webhook' but is not in WEBHOOK_ROUTES",
  );
});

test('an authenticated route with a tenant parameter keeps the app from becoming ready, naming the route', async () => {
  const { app } = await testApp();
  app.get('/api/installations/:installationId/widgets', { config: { access: 'authenticated' } }, () => 'x');
  await expect(app.ready()).rejects.toThrow(
    'route GET /api/installations/:installationId/widgets is authenticated but its path has the tenant parameter :installationId',
  );
});

test('a tenant route that changes data and declares itself read keeps the app from becoming ready', async () => {
  const { app } = await testApp();
  app.post(
    '/api/installations/:installationId/things',
    { config: { access: READ, audit: 'repository.enabled' } },
    () => 'x',
  );
  await expect(app.ready()).rejects.toThrow(
    "route POST /api/installations/:installationId/things is a tenant route that changes data, so its mode must be 'write'",
  );
});

test('a route whose declaration is added by the onRoute hook of a plugin scope is recorded with it, since the guard acts on the config the route ends with', async () => {
  const { app } = await testApp();
  await app.register((scope, _options, done) => {
    scope.addHook('onRoute', (route) => {
      route.config = { ...route.config, access: 'public' };
    });
    scope.get('/from-the-scope', { exposeHeadRoute: false }, () => 'x');
    done();
  });
  await app.ready();
  expect(app.routeAccess.filter((entry) => entry.url === '/from-the-scope')).toEqual([
    { method: 'GET', url: '/from-the-scope', access: 'public' },
  ]);
});

test('a declaration that a plugin scope adds is checked like any other: a value that is not one keeps the app from becoming ready', async () => {
  const { app } = await testApp();
  await app.register((scope, _options, done) => {
    scope.addHook('onRoute', (route) => {
      // @ts-expect-error -- a made-up kind: the types refuse it, and the check when the app becomes ready must too
      route.config = { ...route.config, access: 'admin' };
    });
    scope.get('/from-the-scope', { exposeHeadRoute: false }, () => 'x');
    done();
  });
  await expect(app.ready()).rejects.toThrow(
    'route GET /from-the-scope declares a config.access that is not one of public, authenticated, webhook, operator, tenant',
  );
});
