// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { id } from '../../services/github-contract/test-support.ts';
import { InstallationNotAdmittedError } from '../../services/ports/github-errors.ts';
import { type TenantResolver, tenantAccess } from './tenant-access.ts';
import {
  type GuardWorld,
  githubInstallationOf,
  guardWorld,
  PEOPLE,
  tenantTables,
} from './tenant-guard-fixture/test-support.ts';

// What the guard does with a tenant that is suspended or deleted (E11-S05, E11-S07): GitHub refuses the installation's
// tokens then, so no role is asked of it. The owner of a user account is known from the row and passes, a read to be served
// and a write to be refused with a 409; nobody else can be verified, so everyone else gets the uniform 404, except the
// admins of an organisation that the ledger remembers (tenant-guard-ledger.test.ts).

test.each([
  ['suspended', (world: GuardWorld) => world.tenants.suspendedUser, 'installation_suspended'],
  ['deleted', (world: GuardWorld) => world.tenants.deletedUser, 'installation_deleted'],
] as const)(
  'the owner of a %s user account reads it and is refused a write by 409 %s',
  async (_state, tenantOf, code) => {
    const world = await guardWorld();
    const tenant = tenantOf(world);
    const before = await tenantTables(world.db);
    const read = await world.ask('GET', `/t/installations/${tenant}`, 'owner');
    expect([read.statusCode, read.json()]).toEqual([
      200,
      { tenant: { installationId: tenant, repositoryId: null, role: 'org_admin' } },
    ]);
    const write = await world.ask('POST', `/t/installations/${tenant}`, 'owner');
    expect(write.statusCode).toBe(409);
    expect(write.json()).toEqual({ error: { code, message: 'Conflict', requestId: write.headers['x-request-id'] } });
    expect(world.reached).toEqual(['installation-get']);
    expect(world.fake.calls).toEqual([]);
    expect(await tenantTables(world.db)).toBe(before);
  },
);

test.each([
  ['an admin of another organisation', 'admin1'],
  ['an admin of the second tenant', 'admin2'],
  ['somebody who owns nothing', 'outsider'],
] as const)(
  '%s gets the uniform 404, not the 409, on a suspended user account: no role, no state',
  async (_who, person) => {
    const world = await guardWorld();
    const tenant = world.tenants.suspendedUser;
    const read = await world.ask('GET', `/t/installations/${tenant}`, person);
    const write = await world.ask('POST', `/t/installations/${tenant}`, person);
    expect([read.statusCode, write.statusCode]).toEqual([404, 404]);
    expect(write.json()).toMatchObject({ error: { code: 'not_found' } });
    expect(world.reached).toEqual([]);
  },
);

test('an admin of a suspended organisation the ledger has never seen is told 404, and GitHub is not asked: its tokens are refused', async () => {
  const world = await guardWorld();
  const tenant = world.tenants.suspendedOrg;
  const read = await world.ask('GET', `/t/installations/${tenant}`, 'admin1');
  const write = await world.ask('POST', `/t/installations/${tenant}`, 'admin1');
  const repository = await world.ask('GET', `/t/repositories/${world.repositories.suspendedOrgR1}`, 'admin1');
  expect([read.statusCode, write.statusCode, repository.statusCode]).toEqual([404, 404, 404]);
  expect(world.fake.calls.filter((call) => call.installationId === githubInstallationOf(6))).toEqual([]);
  expect(world.reached).toEqual([]);
});

test('the state is read from the database for every request, with no invalidation when it changes', async () => {
  const world = await guardWorld();
  const url = `/t/installations/${world.tenants.t1}`;
  expect((await world.ask('GET', url, 'admin1')).statusCode).toBe(200);
  // The admin's role is cached now, and a live lookup put them in the ledger; the installation is suspended, and the very
  // next request knows: the read is served from the ledger and the write is refused with the state.
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date() })
    .where('id', '=', world.tenants.t1)
    .execute();
  expect((await world.ask('GET', url, 'admin1')).statusCode).toBe(200);
  const suspended = await world.ask('POST', url, 'admin1');
  expect([suspended.statusCode, suspended.json()]).toMatchObject([409, { error: { code: 'installation_suspended' } }]);
  await world.db.updateTable('installations').set({ suspended_at: null }).where('id', '=', world.tenants.t1).execute();
  expect((await world.ask('POST', url, 'admin1')).statusCode).toBe(200);
  await world.db
    .updateTable('installations')
    .set({ deleted_at: new Date() })
    .where('id', '=', world.tenants.t1)
    .execute();
  const deleted = await world.ask('POST', url, 'admin1');
  expect([deleted.statusCode, deleted.json()]).toMatchObject([409, { error: { code: 'installation_deleted' } }]);
  const owned = `/t/installations/${world.tenants.suspendedUser}`;
  expect((await world.ask('POST', owned, 'owner')).statusCode).toBe(409);
  await world.db
    .updateTable('installations')
    .set({ suspended_at: null })
    .where('id', '=', world.tenants.suspendedUser)
    .execute();
  expect((await world.ask('POST', owned, 'owner')).statusCode).toBe(200);
});

test('an installation that GitHub stops serving between the read of the row and the lookup is the uniform 404', async () => {
  const world = await guardWorld();
  world.fake.failNext('getOrgMembership', new InstallationNotAdmittedError('suspended'));
  const answer = await world.ask('GET', `/t/installations/${world.tenants.t1}`, 'admin1');
  expect(answer.statusCode).toBe(404);
  expect(answer.json()).toMatchObject({ error: { code: 'not_found' } });
  expect(world.reached).toEqual([]);
});

/** A tenant route whose resolver is `resolve`, added to the world before its first request. */
function withResolver(world: GuardWorld, resolve: TenantResolver) {
  world.app.get('/t/custom', { config: { access: tenantAccess({ mode: 'read', resolve }) } }, () => {
    world.reached.push('custom');
    return 'reached';
  });
  return () => world.ask('GET', '/t/custom', 'admin1');
}

test('a resolver that forgets the admission rule cannot let a rejected tenant through, even for its own admin', async () => {
  const world = await guardWorld();
  world.fake.addMembership(id(300), 'org-3', `login-${PEOPLE.admin1}`, {
    state: 'active',
    role: 'admin',
    userId: id(PEOPLE.admin1),
  });
  const answer = await withResolver(world, () =>
    Promise.resolve({ installationId: world.tenants.rejected, repositoryId: null, requirement: 'org_admin' }),
  )();
  expect(answer.statusCode).toBe(404);
  expect(world.reached).toEqual([]);
  expect(world.fake.calls).toEqual([]);
});

test.each([
  ['a repository that does not exist', () => 987_654],
  ["another tenant's repository", (world: GuardWorld) => world.repositories.t2r1],
  ['a removed repository', (world: GuardWorld) => world.repositories.t1removed],
])(
  'a resolver that names %s under a tenant is the uniform 404: the repository is read with the installation id',
  async (_name, pick) => {
    const world = await guardWorld();
    const answer = await withResolver(world, () =>
      Promise.resolve({ installationId: world.tenants.t1, repositoryId: pick(world), requirement: 'repo_admin' }),
    )();
    expect(answer.statusCode).toBe(404);
    expect(world.reached).toEqual([]);
  },
);

test('a resolver that throws something that is not a denial fails the request, and the handler does not run', async () => {
  const world = await guardWorld();
  const answer = await withResolver(world, () => Promise.reject(new Error('the resolver broke')))();
  expect(answer.statusCode).toBe(500);
  expect(world.reached).toEqual([]);
  expect(answer.body).not.toContain('the resolver broke');
});
