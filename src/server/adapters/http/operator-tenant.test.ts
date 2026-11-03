// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { addCanaryRoutes, CANARY_CASES, LEAKY_CROSS_TENANT } from './cross-tenant-canary/test-support.ts';
import { CROSS_TENANT_CASES, type CrossTenantCase } from './cross-tenant-fixture/test-support.ts';
import {
  assertOperatorCase,
  type InactiveState,
  type MatrixWorld,
  matrixWorld,
  operatorWorld,
} from './cross-tenant-runner/test-support.ts';
import { declaredAccess } from './route-access-model.ts';

// Operator is not tenant admin (E11-S08): the person who operates the instance, and is neither org admin nor an admin the
// ledger remembers, gets the uniform `404` from every tenant route. The routes come from the route table of the app, so a
// route that a later story adds is held to this as soon as it has its case in CROSS_TENANT_CASES (E11-S06 fails the build
// without one).

const CASES = new Map(Object.entries({ ...CROSS_TENANT_CASES, ...CANARY_CASES, ...LEAKY_CROSS_TENANT }));
const REAL_CASES = new Map(Object.entries(CROSS_TENANT_CASES));

/** The tenant routes of the app, `METHOD path`, from its route table. */
async function tenantRoutes(world: MatrixWorld): Promise<string[]> {
  await world.app.ready();
  return world.app.routeAccess
    .filter((entry) => typeof declaredAccess(entry.access) === 'object')
    .map((entry) => `${entry.method} ${entry.url}`);
}

/**
 * A person may cost the tenants 30 uncached role lookups a minute (E11-S04), and each write route spends seven of them here, so
 * the clock moves on a minute after every route, as time would pass between the calls of a person: the check is about what the
 * operator is shown, not about that budget.
 */
const PERSON_BUDGET_WINDOW_SECONDS = 61;

const STATES: readonly (InactiveState | null)[] = [null, 'suspended', 'deleted', 'rejected'];

test.each(STATES)(
  'the operator gets the 404 of an unknown id from every tenant route of the table, tenant 1 being %s',
  async (state) => {
    const world = await operatorWorld();
    addCanaryRoutes(world);
    const routes = await tenantRoutes(world);
    // The six classes of the canary and the leaky one, so the loop below runs over something even before the first real route.
    expect(routes.length).toBeGreaterThanOrEqual(7);
    for (const route of routes) {
      const c = CASES.get(route);
      if (c === undefined) {
        throw new Error(`tenant route ${route} has no case: add it to CROSS_TENANT_CASES`);
      }
      await assertOperatorCase(world, route, c, state);
      world.advance(PERSON_BUDGET_WINDOW_SECONDS);
    }
  },
);

test('every case of the application holds for the operator', async () => {
  const world = await operatorWorld();
  for (const route of await tenantRoutes(world)) {
    const c = REAL_CASES.get(route);
    if (c === undefined) {
      throw new Error(`tenant route ${route} has no case: add it to CROSS_TENANT_CASES`);
    }
    await assertOperatorCase(world, route, c);
    world.advance(PERSON_BUDGET_WINDOW_SECONDS);
  }
  expect(world.app.routeAccess.some((entry) => entry.access === 'operator')).toBe(true);
});

// The start-up check refuses an operator route that names a tenant parameter (route-access.ts), so the leaky route here calls
// its parameter something else: the check is by name, and this is the route that gets past it. The matrix finds it by what it
// answers.
const LEAKY_OPERATOR_PATH = '/canary/leaky/operator/installations/:account';

const LEAKY_OPERATOR_CASE: CrossTenantCase = {
  endpointClass: 'installation_read',
  request: (target) => ({
    method: 'GET',
    url: LEAKY_OPERATOR_PATH.replace(':account', String(target.installationId)),
  }),
};

test('the check fails, naming the route, on a route that hands tenant data to the operator role', async () => {
  const world = await operatorWorld();
  world.app.get(LEAKY_OPERATOR_PATH, { config: { access: 'operator' } }, () => ({ tenant: 'data' }));
  await expect(assertOperatorCase(world, `GET ${LEAKY_OPERATOR_PATH}`, LEAKY_OPERATOR_CASE)).rejects.toThrow(
    /GET \/canary\/leaky\/operator\/installations\/:account \(the operator\)/,
  );
});

test('the operator keeps the access of the instance while tenant routes refuse them: the list is theirs, a tenant is not', async () => {
  const world = await operatorWorld();
  addCanaryRoutes(world);
  const list = await world.ask('outsider', { method: 'GET', url: '/api/operator/installations' });
  const tenant = await world.ask('outsider', {
    method: 'GET',
    url: `/canary/installations/${world.t1.installationId}`,
  });
  expect([list.statusCode, tenant.statusCode]).toEqual([200, 404]);
});

test('an operator who is also the org admin of a tenant has that tenant by the admin role and no other tenant by the operator role', async () => {
  const world = await matrixWorld({ OPERATOR_GITHUB_IDS: '31001' });
  addCanaryRoutes(world);
  const own = await world.ask('admin1', { method: 'GET', url: `/canary/installations/${world.t1.installationId}` });
  const other = await world.ask('admin1', { method: 'GET', url: `/canary/installations/${world.t2.installationId}` });
  const list = await world.ask('admin1', { method: 'GET', url: '/api/operator/installations' });
  expect([own.statusCode, other.statusCode, list.statusCode]).toEqual([200, 404, 200]);
});
