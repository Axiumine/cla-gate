// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  addCanaryRoutes,
  CANARY_CASES,
  CANARY_ISOLATION,
  LEAKY_CASE,
  LEAKY_CROSS_TENANT,
  LEAKY_HONOURING,
  LEAKY_ISOLATION,
  LEAKY_ROUTE,
  LEAKY_UNFILTERED,
} from './cross-tenant-canary/test-support.ts';
import {
  CROSS_TENANT_CASES,
  ISOLATION_CASES,
  matrixGaps,
  NO_TENANT_DATA,
} from './cross-tenant-fixture/test-support.ts';
import {
  assertCrossTenantCase,
  assertIsolationCase,
  matrixWorld,
  plainTarget,
  scopedTarget,
} from './cross-tenant-runner/test-support.ts';

// The cross-tenant route matrix (E11-S06). It is generated from the route table: a tenant route without a case in
// CROSS_TENANT_CASES, or an authenticated route in neither ISOLATION_CASES nor NO_TENANT_DATA, fails the build with its
// name. The application has no tenant route yet, so the matrix is also run over canary routes of the six classes, and
// shown to fail on routes that break the rules.

test('every tenant route of the application has a case and every authenticated route is classified: the check names none', async () => {
  const { app } = await matrixWorld();
  await app.ready();
  const tables = { cross: CROSS_TENANT_CASES, isolation: ISOLATION_CASES, noTenantData: NO_TENANT_DATA };
  expect(matrixGaps(app.routeAccess, tables)).toEqual([]);
  expect(app.routeAccess.some((entry) => entry.url === '/api/auth/session')).toBe(true);
});

test('every case of the two tables holds for the application: tenant 2 learns nothing of tenant 1, and no denied call changes a row', async () => {
  const world = await matrixWorld();
  // The isolation cases come first: the last cross-tenant case erases `member1`, the signer of tenant 1 (E16-S04), which ends that
  // person's session, and the export of their own data (E16-S06) is asked for as `member1`.
  for (const [route, c] of Object.entries(ISOLATION_CASES)) {
    await assertIsolationCase(world, route, c);
  }
  for (const [route, c] of Object.entries(CROSS_TENANT_CASES)) {
    await assertCrossTenantCase(world, route, c);
  }
  await world.app.ready();
  expect(world.app.routeAccess.length).toBeGreaterThan(0);
});

test('the canary routes are the tenant and authenticated routes the canary tables name, and the check finds no gap in them', async () => {
  const world = await matrixWorld();
  addCanaryRoutes(world);
  await world.app.ready();
  const tables = {
    cross: { ...CROSS_TENANT_CASES, ...CANARY_CASES, ...LEAKY_CROSS_TENANT },
    isolation: { ...ISOLATION_CASES, ...CANARY_ISOLATION, ...LEAKY_ISOLATION },
    noTenantData: NO_TENANT_DATA,
  };
  expect(matrixGaps(world.app.routeAccess, tables)).toEqual([]);
  expect(matrixGaps(world.app.routeAccess, { ...tables, cross: { ...CROSS_TENANT_CASES, ...CANARY_CASES } })).toEqual([
    'tenant route GET /canary/leaky/installations/:installationId/repositories/:repositoryId has no entry in CROSS_TENANT_CASES',
  ]);
  expect(Object.keys(CANARY_CASES)).toEqual([
    'GET /canary/installations/:installationId',
    'POST /canary/installations/:installationId',
    'GET /canary/installations/:installationId/repositories/:repositoryId',
    'POST /canary/installations/:installationId/repositories/:repositoryId',
    'GET /canary/installations/:installationId/documents/:documentId',
    'POST /canary/installations/:installationId/documents/:documentId',
  ]);
});

test.each(Object.entries(CANARY_CASES))(
  'the matrix holds for the canary route %s, and its handler ran only for the people allowed',
  async (route, c) => {
    const world = await matrixWorld();
    const reached = addCanaryRoutes(world);
    await assertCrossTenantCase(world, route, c);
    // The admin of the organisation, and the admin of the repository where the role matrix lets them: never a denied call.
    expect(reached).toEqual(c.endpointClass.startsWith('installation_') ? [route] : [route, route]);
  },
);

test.each(Object.entries(CANARY_CASES))(
  'a tenant the admission policy rejected is invisible to its own admin on the canary route %s',
  async (_route, c) => {
    const world = await matrixWorld();
    const reached = addCanaryRoutes(world);
    await world.db
      .updateTable('installations')
      .set({ admission_status: 'rejected', admission_reason: 'policy_changed' })
      .where('id', '=', world.t1.installationId)
      .execute();
    const plain = await world.ask('admin1', c.request(plainTarget(world.t1)));
    const scoped = await world.ask('admin1', c.request(scopedTarget(world.t1)));
    expect([plain.statusCode, scoped.statusCode]).toEqual([404, 404]);
    expect(reached).toEqual([]);
  },
);

test('the matrix fails, naming the route, on a route that checks the installation of its path and trusts the id of the repository', async () => {
  const world = await matrixWorld();
  addCanaryRoutes(world);
  await expect(assertCrossTenantCase(world, LEAKY_ROUTE, LEAKY_CASE)).rejects.toThrow(
    /GET \/canary\/leaky\/installations\/:installationId\/repositories\/:repositoryId with crossed ids as admin2/,
  );
});

test.each(Object.entries(CANARY_ISOLATION))('the isolation matrix holds for the canary route %s', async (route, c) => {
  const world = await matrixWorld();
  addCanaryRoutes(world);
  await assertIsolationCase(world, route, c);
});

test('the isolation matrix fails on a route that honours an injected installation id', async () => {
  const world = await matrixWorld();
  addCanaryRoutes(world);
  await expect(assertIsolationCase(world, 'GET /canary/leaky/me/signatures', LEAKY_HONOURING)).rejects.toThrow(
    /does not ignore the ids member1 injects/,
  );
});

test('the isolation matrix fails on a route that shows rows of another person and tenant', async () => {
  const world = await matrixWorld();
  addCanaryRoutes(world);
  await expect(assertIsolationCase(world, 'GET /canary/leaky/signatures', LEAKY_UNFILTERED)).rejects.toThrow(
    /shows member1 rows of another tenant or person/,
  );
});
