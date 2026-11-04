// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type * as FastifyModule from 'fastify';
import { expect, test, vi } from 'vitest';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { declaredAccess, PUBLIC_ROUTES, WEBHOOK_ROUTES } from './route-access-model.ts';
import { accessProblem } from './route-access-problems.ts';
import { webFixture } from './spa-fixture/test-support.ts';
import { tenantAccess } from './tenant-access.ts';

// The route table of the real application (E11-S01): every route registered while the app is built, collected twice. Once by
// an `onRoute` hook that is added to the Fastify instance the moment it is created, before any route exists (so it does not
// depend on the hook under test), and once by `app.routeAccess`, the table the application keeps itself.

interface SeenRoute {
  readonly method: string | readonly string[];
  readonly url: string;
}

const seen = vi.hoisted((): SeenRoute[] => []);

vi.mock('fastify', async (importOriginal) => {
  const actual = await importOriginal<typeof FastifyModule>();
  const create = (options: FastifyModule.FastifyServerOptions) => {
    const app = actual.default(options);
    app.addHook('onRoute', (route) => {
      seen.push({ method: route.method, url: route.url });
    });
    return app;
  };
  return { ...actual, default: create };
});

/** The five path parameters that name a tenant resource, written here again on purpose: the test does not read the constant of the code under test. */
const TENANT_PARAMETER = /:(installationId|repositoryId|documentId|signatureId|entryId)\b/;

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

interface TableEntry {
  readonly method: string;
  readonly url: string;
  readonly access: unknown;
}

const sorted = (names: readonly string[]): string[] => names.toSorted((a, b) => a.localeCompare(b));

const nameOf = (entry: { readonly method: string; readonly url: string }): string => `${entry.method} ${entry.url}`;

/** The table of the application as it runs in production: with a built single-page app to serve (E17-S03), so its file routes are in it. */
async function tableOfTheApp() {
  seen.length = 0;
  const { app } = await testApp({ env: { ...AUTH_ENV, NODE_ENV: 'test', WEB_ROOT: webFixture().root } });
  await app.ready();
  return { app, table: app.routeAccess, registered: [...seen] };
}

/** The tenant routes that break the two mode rules: a mode other than read or write, and a read route that changes data. */
function tenantModeOffenders(table: readonly TableEntry[]): string[] {
  return table.flatMap((entry) => {
    const access = entry.access;
    const tenant = typeof access === 'object' && access !== null && 'kind' in access && access.kind === 'tenant';
    if (!tenant) {
      return [];
    }
    const mode = 'mode' in access ? access.mode : undefined;
    const valid = mode === 'read' || mode === 'write';
    return valid && (mode === 'write' || !MUTATING.includes(entry.method)) ? [] : [nameOf(entry)];
  });
}

test('the table is collected: the application registers its routes with the login configured', async () => {
  const { table } = await tableOfTheApp();
  const names = table.map(nameOf);
  expect(names).toContain('GET /api/auth/session');
  expect(names).toContain('POST /webhooks/github');
  expect(names).toContain('GET /healthz');
});

test('the table of the application holds every route Fastify registered, once each, and the implicit HEAD routes are not entries', async () => {
  const { table, registered } = await tableOfTheApp();
  // The implicit HEAD route of a GET route is registered on its own, as the method 'HEAD'; the file routes answer both methods with one route (['HEAD', 'GET']), so their HEAD is an entry.
  const all = registered.flatMap((route) =>
    [route.method]
      .flat()
      .map((method) => ({ name: `${method.toUpperCase()} ${route.url}`, implicit: route.method === 'HEAD' })),
  );
  // `GET /` is the throw-away instance that framework-errors.ts creates to read the security headers: not a route of the app.
  const ofTheApp = all.filter((route) => route.name !== 'GET /');
  expect(table.map(nameOf)).toEqual(ofTheApp.filter((route) => !route.implicit).map((route) => route.name));
  expect(ofTheApp.filter((route) => route.implicit)).not.toEqual([]);
  expect(table.map(nameOf)).toContain('HEAD /*');
});

test('every route of the table declares a valid access', async () => {
  const { table } = await tableOfTheApp();
  expect(table.flatMap((entry) => accessProblem(entry.method, entry.url, entry.access) ?? [])).toEqual([]);
  expect(table.filter((entry) => declaredAccess(entry.access) === undefined).map(nameOf)).toEqual([]);
});

test('the routes declared public are exactly PUBLIC_ROUTES, so a new public route is a reviewed edit of the constant', async () => {
  const { table } = await tableOfTheApp();
  const declared = table.filter((entry) => entry.access === 'public').map(nameOf);
  expect(sorted(declared)).toEqual(sorted(PUBLIC_ROUTES));
  expect(sorted(declared)).toEqual([
    'GET /*',
    'GET /api/auth/callback',
    'GET /api/auth/login',
    'GET /api/meta',
    'GET /healthz',
    'GET /readyz',
    'HEAD /*',
  ]);
});

test('the route declared webhook is exactly POST /webhooks/github', async () => {
  const { table } = await tableOfTheApp();
  const declared = table.filter((entry) => entry.access === 'webhook').map(nameOf);
  expect(declared).toEqual([...WEBHOOK_ROUTES]);
  expect(declared).toEqual(['POST /webhooks/github']);
});

test('the authenticated routes are the session read, the logout, the export of the own data and the list of the installations the person administers, and none has a tenant parameter', async () => {
  const { table } = await tableOfTheApp();
  const authenticated = table.filter((entry) => entry.access === 'authenticated');
  expect(sorted(authenticated.map(nameOf))).toEqual([
    'GET /api/auth/session',
    'GET /api/installations',
    'GET /api/me/export',
    'POST /api/auth/logout',
  ]);
  expect(authenticated.filter((entry) => TENANT_PARAMETER.test(entry.url)).map(nameOf)).toEqual([]);
});

test('the operator routes are exactly the list of the operator, and the tenant routes are the eleven of the documents, their draft and their versions, the four of the audit log, the signature export and the erasure, the list of the repositories of an installation, the choice of the CLA of a repository, the two switches of its enforcement, and the adds, the two lists and the removal of an allowlist entry', async () => {
  const { table } = await tableOfTheApp();
  expect(table.filter((entry) => entry.access === 'operator').map(nameOf)).toEqual(['GET /api/operator/installations']);
  expect(sorted(table.filter((entry) => typeof entry.access === 'object').map(nameOf))).toEqual(
    sorted([
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
      'GET /api/installations/:installationId/audit-log',
      'GET /api/installations/:installationId/documents/:documentId/signatures.csv',
      'GET /api/installations/:installationId/erasure-preview',
      'POST /api/installations/:installationId/erasures',
      'GET /api/installations/:installationId/repositories',
      'PUT /api/repositories/:repositoryId/cla-document',
      'POST /api/repositories/:repositoryId/enable',
      'POST /api/repositories/:repositoryId/disable',
      'POST /api/installations/:installationId/allowlist-entries',
      'POST /api/repositories/:repositoryId/allowlist-entries',
      'GET /api/installations/:installationId/allowlist-entries',
      'GET /api/repositories/:repositoryId/allowlist-entries',
      'DELETE /api/installations/:installationId/allowlist-entries/:entryId',
    ]),
  );
});

test('every tenant route the application gets is read or write and write when it changes data', async () => {
  const { table } = await tableOfTheApp();
  expect(table.filter((entry) => declaredAccess(entry.access) === undefined)).toEqual([]);
  expect(tenantModeOffenders(table)).toEqual([]);
});

test('the mode check of the route table names a tenant route with no mode, an unknown mode, or a read mode on a state-changing method', () => {
  const tenant = (mode: unknown) => ({ kind: 'tenant', mode });
  const offenders = tenantModeOffenders([
    { method: 'GET', url: '/ok-read', access: tenant('read') },
    { method: 'POST', url: '/ok-write', access: tenant('write') },
    { method: 'GET', url: '/write-on-get', access: tenant('write') },
    { method: 'GET', url: '/no-mode', access: { kind: 'tenant' } },
    { method: 'GET', url: '/odd-mode', access: tenant('rw') },
    { method: 'POST', url: '/post-read', access: tenant('read') },
    { method: 'PUT', url: '/put-read', access: tenant('read') },
    { method: 'PATCH', url: '/patch-read', access: tenant('read') },
    { method: 'DELETE', url: '/delete-read', access: tenant('read') },
    { method: 'POST', url: '/public-post', access: 'public' },
  ]);
  expect(offenders).toEqual([
    'GET /no-mode',
    'GET /odd-mode',
    'POST /post-read',
    'PUT /put-read',
    'PATCH /patch-read',
    'DELETE /delete-read',
  ]);
});

test('a tenant route added to the application is in the table with its mode, and a read route that changes data is caught by name', async () => {
  seen.length = 0;
  const { app } = await testApp({ env: AUTH_ENV });
  const read = tenantAccess({ mode: 'read', resolve: () => Promise.resolve(null) });
  const write = tenantAccess({ mode: 'write', resolve: () => Promise.resolve(null) });
  app.get('/api/canary/:installationId', { config: { access: read } }, () => 'x');
  app.delete('/api/canary/:installationId', { config: { access: write, audit: 'repository.enabled' } }, () => 'x');
  expect(tenantModeOffenders(app.routeAccess)).toEqual([]);
  app.post('/api/canary/:installationId/oops', { config: { access: read, audit: 'repository.enabled' } }, () => 'x');
  expect(tenantModeOffenders(app.routeAccess)).toEqual(['POST /api/canary/:installationId/oops']);
});
