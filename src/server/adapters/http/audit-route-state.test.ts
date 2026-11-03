// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type * as FastifyModule from 'fastify';
import { expect, test, vi } from 'vitest';
import { AUDIT_ACTION_PATTERN } from '../../../shared/audit.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import {
  DOCUMENTED_MUTATIONS,
  type DocumentedMutation,
  type RegisteredRoute,
  routeProblems,
} from './audit-route-state/test-support.ts';
import { AUDIT_EXEMPT_REASONS, auditProblem } from './audit-routes.ts';

// The audit state of the real application (E16-S01): every route registered while the app is built, collected by an
// `onRoute` hook added to the Fastify instance the moment it is created, before any route exists, so it does not depend on
// the guard under test. The route guard of E04-S09 refuses an unaudited mutation at registration; this holds the routes to
// what their stories document and shows that the only exemptions are the three the guard allows.

interface SeenRoute {
  readonly method: string | readonly string[];
  readonly url: string;
  readonly audit: string | undefined;
  readonly exempt: string | undefined;
}

const seen = vi.hoisted((): SeenRoute[] => []);

vi.mock('fastify', async (importOriginal) => {
  const actual = await importOriginal<typeof FastifyModule>();
  const create = (options: FastifyModule.FastifyServerOptions) => {
    const app = actual.default(options);
    app.addHook('onRoute', (route) => {
      seen.push({
        method: route.method,
        url: route.url,
        audit: route.config?.audit,
        exempt: route.config?.auditExempt,
      });
    });
    return app;
  };
  return { ...actual, default: create };
});

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** The mutating routes the application registered, one per method. */
async function registeredMutations(): Promise<{ routes: RegisteredRoute[]; all: SeenRoute[] }> {
  seen.length = 0;
  const { app } = await testApp({ env: AUTH_ENV });
  await app.ready();
  const routes = seen.flatMap((route) =>
    [route.method]
      .flat()
      .map((method) => method.toUpperCase())
      .filter((method) => MUTATING.includes(method))
      .map((method) => ({ name: `${method} ${route.url}`, audit: route.audit, exempt: route.exempt })),
  );
  return { routes, all: [...seen] };
}

test('the application registers its mutating routes with the login configured', async () => {
  const { routes } = await registeredMutations();
  expect(routes.map((route) => route.name)).toEqual(
    expect.arrayContaining(['POST /webhooks/github', 'POST /api/auth/logout']),
  );
});

test('every mutating route under /api declares an audit action or an exemption, exactly one', async () => {
  const { all } = await registeredMutations();
  expect(
    all.flatMap(
      (route) => auditProblem(route.method, route.url, { audit: route.audit, auditExempt: route.exempt }) ?? [],
    ),
  ).toEqual([]);
});

test('the exemption reasons are webhook, session and setup, and no registered route uses another', async () => {
  const { routes } = await registeredMutations();
  expect([...AUDIT_EXEMPT_REASONS]).toEqual(['webhook', 'session', 'setup']);
  const used = new Set(routes.flatMap((route) => route.exempt ?? []));
  expect([...used].filter((reason) => !AUDIT_EXEMPT_REASONS.some((allowed) => allowed === reason))).toEqual([]);
  expect(
    routes
      .filter((route) => route.exempt !== undefined)
      .map((route) => `${route.name} ${route.exempt}`)
      .toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(['POST /api/auth/logout session', 'POST /webhooks/github webhook']);
});

test('every mutating route that a story of E11 to E16 or E19 names resolves to the audit action it documents', async () => {
  const { routes } = await registeredMutations();
  expect(routeProblems(DOCUMENTED_MUTATIONS, routes)).toEqual([]);
});

test('the table of documented routes lists no route twice and no action that the database check on audit_log.action would refuse', () => {
  const names = DOCUMENTED_MUTATIONS.map((entry) => entry.route);
  expect(new Set(names).size).toBe(names.length);
  const actions = DOCUMENTED_MUTATIONS.flatMap((entry) => ('audit' in entry.documents ? entry.documents.audit : []));
  expect(actions.filter((action) => !AUDIT_ACTION_PATTERN.test(action))).toEqual([]);
});

const ROUTE = 'POST /api/sign';
const entry = (overrides: Partial<DocumentedMutation> = {}): DocumentedMutation => ({
  route: ROUTE,
  story: 'E13-S04',
  documents: { audit: ['signature.created'] },
  built: true,
  ...overrides,
});
const route = (overrides: Partial<RegisteredRoute> = {}): RegisteredRoute => ({
  name: ROUTE,
  audit: 'signature.created',
  exempt: undefined,
  ...overrides,
});

test.each([
  ['a built route that declares what its story documents', [entry()], [route()], []],
  ['a route that is not built and not registered', [entry({ built: false })], [], []],
  [
    'a documented route that declares one of two documented actions',
    [entry({ documents: { audit: ['a.b', 'signature.created'] } })],
    [route()],
    [],
  ],
  [
    'an exempt route that declares its exemption',
    [entry({ documents: { exempt: 'setup' } })],
    [route({ audit: undefined, exempt: 'setup' })],
    [],
  ],
  ['a route nobody documents', [], [route({ name: 'POST /api/other', audit: 'other.thing' })], []],
  [
    'a route that is registered but marked not built',
    [entry({ built: false })],
    [route()],
    [`${ROUTE} (E13-S04) is registered: set built to true`],
  ],
  [
    'a route that is marked built but not registered',
    [entry()],
    [],
    [`${ROUTE} (E13-S04) is not registered: set built to false`],
  ],
  [
    'a route that declares another action than its story documents',
    [entry()],
    [route({ audit: 'signature.revoked' })],
    [`${ROUTE} declares signature.revoked, E13-S04 documents signature.created`],
  ],
  [
    'a route that declares nothing where its story documents an action',
    [entry({ documents: { audit: ['a.b', 'signature.created'] } })],
    [route({ audit: undefined })],
    [`${ROUTE} declares nothing, E13-S04 documents a.b or signature.created`],
  ],
  [
    'a route that declares an action where its story documents an exemption',
    [entry({ documents: { exempt: 'setup' } })],
    [route()],
    [`${ROUTE} declares signature.created, E13-S04 documents the exemption setup`],
  ],
  [
    'a route that declares another exemption than documented',
    [entry({ documents: { exempt: 'setup' } })],
    [route({ audit: undefined, exempt: 'session' })],
    [`${ROUTE} declares session, E13-S04 documents the exemption setup`],
  ],
  [
    'a route at another path that declares an action the table documents for a route',
    [entry({ built: false })],
    [route({ name: 'POST /api/signatures' })],
    ['POST /api/signatures declares signature.created, which the table documents for POST /api/sign'],
  ],
  [
    'an exemption reason outside the closed list',
    [],
    [route({ name: 'POST /api/x', audit: undefined, exempt: 'because' })],
    ['POST /api/x declares the exemption because, which is not one of webhook, session, setup'],
  ],
])('the route check: %s', (_name, table, registered, expected) => {
  expect(routeProblems(table, registered)).toEqual(expected);
});
