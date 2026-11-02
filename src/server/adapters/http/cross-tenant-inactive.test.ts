// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { addCanaryRoutes, CANARY_CASES } from './cross-tenant-canary/test-support.ts';
import { CROSS_TENANT_CASES, type CrossTenantCase } from './cross-tenant-fixture/test-support.ts';
import { assertInactiveCase, type InactiveState, matrixWorld } from './cross-tenant-runner/test-support.ts';
import { tenantAccess } from './tenant-access.ts';
import { byInstallationParam } from './tenant-resolvers.ts';

// The cross-tenant route matrix of E11-S06 run once more per inactive state (E11-S07): a tenant that is suspended or deleted
// serves each `read` route its normal success to the org admin the ledger remembers and refuses each `write` route with the
// `409` of its state; everybody else gets the `404` of an unknown id; a rejected tenant is invisible to all.

const STATES: readonly InactiveState[] = ['suspended', 'deleted', 'rejected'];

const CASES = Object.entries(CANARY_CASES).flatMap(([route, c]) => STATES.map((state) => [route, c, state] as const));

test.each(CASES)('the matrix holds for the canary route %s when the tenant is %s', async (route, c, state) => {
  const world = await matrixWorld();
  const reached = addCanaryRoutes(world);
  await assertInactiveCase(world, route, c, state);
  // Only the remembered admin of a tenant that is away reaches a read route; a write is refused with the 409 first.
  const served = state !== 'rejected' && c.endpointClass.endsWith('_read');
  expect(reached).toEqual(served ? [route] : []);
});

test.each(STATES)('every case of the application holds when the tenant is %s', async (state) => {
  const world = await matrixWorld();
  for (const [route, c] of Object.entries(CROSS_TENANT_CASES)) {
    await assertInactiveCase(world, route, c, state);
  }
  await world.app.ready();
  expect(world.app.routeAccess.length).toBeGreaterThan(0);
});

const MISLABELLED = 'GET /canary/installations/:installationId/changes-data';

const MISLABELLED_CASE: CrossTenantCase = {
  endpointClass: 'installation_write',
  request: (target) => ({ method: 'GET', url: `/canary/installations/${target.installationId}/changes-data` }),
};

test('the matrix fails, naming the route, on a route that changes data but is declared as a read: a suspended tenant would let it through', async () => {
  const world = await matrixWorld();
  world.app.get(
    '/canary/installations/:installationId/changes-data',
    { config: { access: tenantAccess({ mode: 'read', resolve: byInstallationParam(world.db) }) } },
    () => 'changed something',
  );
  await expect(assertInactiveCase(world, MISLABELLED, MISLABELLED_CASE, 'suspended')).rejects.toThrow(
    /GET \/canary\/installations\/:installationId\/changes-data of a suspended tenant/,
  );
});

test('the tenant is active again after a case, so the next one starts from the same world', async () => {
  const world = await matrixWorld();
  addCanaryRoutes(world);
  const [route, c] = Object.entries(CANARY_CASES)[0] ?? [];
  if (route === undefined || c === undefined) {
    throw new Error('the canary has no case');
  }
  await assertInactiveCase(world, route, c, 'deleted');
  const row = await world.db
    .selectFrom('installations')
    .select(['admission_status', 'suspended_at', 'deleted_at'])
    .where('id', '=', world.t1.installationId)
    .executeTakeFirstOrThrow();
  expect(row).toEqual({ admission_status: 'admitted', suspended_at: null, deleted_at: null });
});
