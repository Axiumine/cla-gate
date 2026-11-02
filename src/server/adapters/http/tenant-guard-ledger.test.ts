// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { id } from '../../services/github-contract/test-support.ts';
import type { InstallationRowId } from '../db/installation-row-id.ts';
import { type TenantResolver, tenantAccess } from './tenant-access.ts';
import {
  type GuardWorld,
  githubInstallationOf,
  guardWorld,
  PEOPLE,
  shapeOf,
  tenantTables,
} from './tenant-guard-fixture/test-support.ts';

// The ledger of org admins at the guard (E11-S07). GitHub refuses the tokens of a suspended or deleted installation, so
// no role is asked of it; an admin whom a live lookup saw in the last 14 days is still an org admin there, for reads, and a
// write is refused with the state. Tenant 6 is an organisation; its admin is `admin1`, who is an admin of it at GitHub.

const DAY_MS = 86_400_000;
const AWAY = new Date('2026-06-01T12:00:00Z');

interface StateColumns {
  suspended_at: Date | null;
  deleted_at: Date | null;
}

async function setState(world: GuardWorld, tenant: InstallationRowId, state: Partial<StateColumns>): Promise<void> {
  await world.db.updateTable('installations').set(state).where('id', '=', tenant).execute();
}

/** The installation id of tenant 6, the organisation. */
const org = (world: GuardWorld): InstallationRowId => world.tenants.suspendedOrg;

/** The ledger rows of a tenant as `person seen_at`, in the order of the people. */
async function ledgerOf(world: GuardWorld, tenant: InstallationRowId): Promise<string[]> {
  const rows = await world.db
    .selectFrom('installation_admin_seen')
    .select(['user_github_id', 'seen_at'])
    .where('installation_id', '=', tenant)
    .orderBy('user_github_id')
    .execute();
  return rows.map((row) => `${row.user_github_id} ${row.seen_at.toISOString()}`);
}

/** Puts `person` in the ledger of the tenant as seen `agoMs` before the clock of the world. */
async function seeAdmin(world: GuardWorld, tenant: InstallationRowId, githubId: number, agoMs: number): Promise<void> {
  await world.db
    .insertInto('installation_admin_seen')
    .values({
      installation_id: tenant,
      user_github_id: githubId,
      seen_at: new Date(world.clock.now().getTime() - agoMs),
    })
    .onConflict((conflict) =>
      conflict
        .columns(['installation_id', 'user_github_id'])
        .doUpdateSet((eb) => ({ seen_at: eb.ref('excluded.seen_at') })),
    )
    .execute();
}

/** Tenant 6 is served for a moment and `admin1` reads it, so a live lookup records them; then it is away again. */
async function seenThenAway(world: GuardWorld, away: Partial<StateColumns>): Promise<void> {
  await setState(world, org(world), { suspended_at: null });
  expect((await world.ask('GET', `/t/installations/${org(world)}`, 'admin1')).statusCode).toBe(200);
  await setState(world, org(world), away);
}

const DELETED = { suspended_at: null, deleted_at: AWAY } as const;
const SUSPENDED = { suspended_at: AWAY, deleted_at: null } as const;

test.each([
  ['suspended', SUSPENDED, 'installation_suspended'],
  ['deleted', DELETED, 'installation_deleted'],
] as const)(
  'an admin seen by a live lookup reads a %s organisation as an org admin, and a write is refused by 409 %s',
  async (_state, away, code) => {
    const world = await guardWorld();
    await seenThenAway(world, away);
    const asked = world.fake.calls.length;
    const installation = `/t/installations/${org(world)}`;
    const repository = `/t/repositories/${world.repositories.suspendedOrgR1}`;
    const read = await world.ask('GET', installation, 'admin1');
    expect([read.statusCode, read.json()]).toEqual([
      200,
      { tenant: { installationId: org(world), repositoryId: null, role: 'org_admin' } },
    ]);
    const repositoryRead = await world.ask('GET', repository, 'admin1');
    expect([repositoryRead.statusCode, repositoryRead.json()]).toEqual([
      200,
      { tenant: { installationId: org(world), repositoryId: world.repositories.suspendedOrgR1, role: 'org_admin' } },
    ]);
    for (const url of [installation, repository]) {
      const write = await world.ask('POST', url, 'admin1');
      expect(write.statusCode).toBe(409);
      expect(write.json()).toEqual({ error: { code, message: 'Conflict', requestId: write.headers['x-request-id'] } });
    }
    expect(world.reached).toEqual(['installation-get', 'installation-get', 'repository-get']);
    // Not one call to GitHub since the tenant went away: the role is the ledger's.
    expect(world.fake.calls).toHaveLength(asked);
  },
);

test.each([
  ['somebody who administers nothing', 'outsider'],
  ['an admin of another organisation', 'admin2'],
  ['an org member who is no admin', 'member1'],
  ['an admin of one repository of another tenant', 'repoAdmin1'],
] as const)('%s gets the uniform 404 on a suspended organisation, for a read and for a write', async (_who, person) => {
  const world = await guardWorld();
  await seenThenAway(world, SUSPENDED);
  const before = await tenantTables(world.db);
  const unknown = shapeOf(await world.ask('GET', '/t/installations/987654', person));
  for (const method of ['GET', 'POST'] as const) {
    expect(shapeOf(await world.ask(method, `/t/installations/${org(world)}`, person))).toEqual(unknown);
  }
  expect(world.reached).toEqual(['installation-get']);
  expect(await tenantTables(world.db)).toBe(before);
});

test('a repository admin who is no org admin cannot be verified on a suspended tenant: only an org admin passes there', async () => {
  const world = await guardWorld();
  const repository = `/t/repositories/${world.repositories.t1r1}`;
  expect((await world.ask('GET', repository, 'repoAdmin1')).statusCode).toBe(200);
  await setState(world, world.tenants.t1, SUSPENDED);
  expect((await world.ask('GET', repository, 'repoAdmin1')).statusCode).toBe(404);
  expect((await world.ask('GET', repository, 'admin1')).statusCode).toBe(404);
  expect(await ledgerOf(world, world.tenants.t1)).toEqual([]);
});

test.each([
  ['day 13', 13 * DAY_MS, 200],
  ['exactly 14 days', 14 * DAY_MS, 200],
  ['day 15', 15 * DAY_MS, 404],
] as const)('an admin last seen on %s reads a suspended organisation with %i', async (_when, ago, status) => {
  const world = await guardWorld();
  await seeAdmin(world, org(world), PEOPLE.admin1, ago);
  const answer = await world.ask('GET', `/t/installations/${org(world)}`, 'admin1');
  expect(answer.statusCode).toBe(status);
  expect(world.fake.calls.filter((call) => call.installationId === githubInstallationOf(6))).toEqual([]);
});

test('a live negative result removes the entry: a demoted admin is no admin of the organisation once it goes away', async () => {
  const world = await guardWorld();
  const installation = `/t/installations/${world.tenants.t1}`;
  expect((await world.ask('POST', installation, 'admin1')).statusCode).toBe(200);
  expect(await ledgerOf(world, world.tenants.t1)).toHaveLength(1);
  world.fake.addMembership(id(100), 'org-1', `login-${PEOPLE.admin1}`, {
    state: 'active',
    role: 'member',
    userId: id(PEOPLE.admin1),
  });
  expect((await world.ask('POST', installation, 'admin1')).statusCode).toBe(404);
  expect(await ledgerOf(world, world.tenants.t1)).toEqual([]);
  await setState(world, world.tenants.t1, SUSPENDED);
  expect((await world.ask('GET', installation, 'admin1')).statusCode).toBe(404);
});

test('the entry is written at most once per 60 seconds per pair, however often a live lookup says yes', async () => {
  const world = await guardWorld();
  const installation = `/t/installations/${world.tenants.t1}`;
  const first = world.clock.now().toISOString();
  const write = async () => (await world.ask('POST', installation, 'admin1')).statusCode;
  expect([await write(), await write(), await write()]).toEqual([200, 200, 200]);
  expect(await ledgerOf(world, world.tenants.t1)).toEqual([`${PEOPLE.admin1} ${first}`]);
  world.advance(59);
  await write();
  expect(await ledgerOf(world, world.tenants.t1)).toEqual([`${PEOPLE.admin1} ${first}`]);
  world.advance(1);
  await write();
  expect(await ledgerOf(world, world.tenants.t1)).toEqual([`${PEOPLE.admin1} ${world.clock.now().toISOString()}`]);
});

test('an answer from the role cache writes nothing: only a live lookup puts a person in the ledger', async () => {
  const world = await guardWorld();
  const installation = `/t/installations/${world.tenants.t1}`;
  await world.ask('GET', installation, 'admin1');
  await world.db.deleteFrom('installation_admin_seen').execute();
  const asked = world.fake.calls.length;
  expect((await world.ask('GET', installation, 'admin1')).statusCode).toBe(200);
  expect(world.fake.calls).toHaveLength(asked);
  expect(await ledgerOf(world, world.tenants.t1)).toEqual([]);
});

test('the role cache is bypassed for a tenant that is not active: a cached admin with no entry is not an admin there', async () => {
  const world = await guardWorld();
  const installation = `/t/installations/${world.tenants.t1}`;
  await world.ask('GET', installation, 'admin1');
  await world.db.deleteFrom('installation_admin_seen').execute();
  expect((await world.ask('GET', installation, 'admin1')).statusCode).toBe(200);
  await setState(world, world.tenants.t1, SUSPENDED);
  expect((await world.ask('GET', installation, 'admin1')).statusCode).toBe(404);
});

test('a tenant the admission policy rejected is invisible to a person in its ledger, whatever the resolver says', async () => {
  const world = await guardWorld();
  await seeAdmin(world, world.tenants.rejected, PEOPLE.admin1, 0);
  await setState(world, world.tenants.rejected, { suspended_at: AWAY });
  const forgetful: TenantResolver = () =>
    Promise.resolve({ installationId: world.tenants.rejected, repositoryId: null, requirement: 'org_admin' });
  world.app.get('/t/forgetful', { config: { access: tenantAccess({ mode: 'read', resolve: forgetful }) } }, () => {
    world.reached.push('forgetful');
    return 'reached';
  });
  const answers = [
    await world.ask('GET', `/t/installations/${world.tenants.rejected}`, 'admin1'),
    await world.ask('POST', `/t/installations/${world.tenants.rejected}`, 'admin1'),
    await world.ask('GET', `/t/repositories/${world.repositories.rejectedR1}`, 'admin1'),
    await world.ask('GET', '/t/forgetful', 'admin1'),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404, 404]);
  expect(world.reached).toEqual([]);
});

test('the ledger is not read for a user account: only its owner is an admin there, by the account id', async () => {
  const world = await guardWorld();
  await seeAdmin(world, world.tenants.suspendedUser, PEOPLE.outsider, 0);
  const url = `/t/installations/${world.tenants.suspendedUser}`;
  expect((await world.ask('GET', url, 'outsider')).statusCode).toBe(404);
  expect((await world.ask('GET', url, 'owner')).statusCode).toBe(200);
});

test('an admin remembered for one organisation is nobody in another that is away', async () => {
  const world = await guardWorld();
  await seeAdmin(world, world.tenants.t1, PEOPLE.admin1, 0);
  await setState(world, org(world), SUSPENDED);
  expect((await world.ask('GET', `/t/installations/${org(world)}`, 'admin1')).statusCode).toBe(404);
});
