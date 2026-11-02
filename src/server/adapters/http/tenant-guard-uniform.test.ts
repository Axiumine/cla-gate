// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { id } from '../../services/github-contract/test-support.ts';
import {
  type GuardWorld,
  githubInstallationOf,
  guardWorld,
  PEOPLE,
  shapeOf,
  tenantTables,
} from './tenant-guard-fixture/test-support.ts';

// The uniform denial of E11-S05: the causes of a 404 cannot be told apart, and a tenant that is rejected, suspended or
// deleted is answered as the tenant guard decides before anything is asked of GitHub.

/** The causes of a 404 for an installation call, each sent by the person who would have been allowed if it were not for the cause. */
function causesOfNotFound(world: GuardWorld) {
  // The admin of the rejected tenant is an admin there at GitHub too: even they do not see it.
  world.fake.addMembership(id(300), 'org-3', `login-${PEOPLE.admin1}`, {
    state: 'active',
    role: 'admin',
    userId: id(PEOPLE.admin1),
  });
  return {
    unknown: world.ask('GET', '/t/installations/987654', 'admin1'),
    otherTenant: world.ask('GET', `/t/installations/${world.tenants.t2}`, 'admin1'),
    rejected: world.ask('GET', `/t/installations/${world.tenants.rejected}`, 'admin1'),
    noRole: world.ask('GET', `/t/installations/${world.tenants.t1}`, 'outsider'),
  };
}

test('the four causes of a 404 are one answer: status, headers and body are equal but for the request id', async () => {
  const world = await guardWorld();
  const causes = causesOfNotFound(world);
  const [unknown, otherTenant, rejected, noRole] = (
    await Promise.all([causes.unknown, causes.otherTenant, causes.rejected, causes.noRole])
  ).map(shapeOf);
  expect(unknown?.status).toBe(404);
  expect(otherTenant).toEqual(unknown);
  expect(rejected).toEqual(unknown);
  expect(noRole).toEqual(unknown);
  expect(unknown?.body).toBe('{"error":{"code":"not_found","message":"Not Found","requestId":"<request id>"}}');
});

test('a 404 for a tenant resource is the answer of a route that does not exist', async () => {
  const world = await guardWorld();
  const unrouted = await world.ask('GET', '/t/no-such-route', 'admin1');
  expect(shapeOf(await causesOfNotFound(world).otherTenant)).toEqual(shapeOf(unrouted));
});

test('a tenant that the admission policy rejected is invisible to its own admin, and GitHub is not asked about it', async () => {
  const world = await guardWorld();
  expect((await causesOfNotFound(world).rejected).statusCode).toBe(404);
  const repository = await world.ask('POST', `/t/repositories/${world.repositories.rejectedR1}`, 'admin1');
  expect(repository.statusCode).toBe(404);
  expect(world.fake.calls.filter((call) => call.installationId === githubInstallationOf(3))).toEqual([]);
  expect(world.reached).toEqual([]);
});

test('a repository that was removed is a 404 on its route, even for an org admin', async () => {
  const world = await guardWorld();
  const removed = await world.ask('GET', `/t/repositories/${world.repositories.t1removed}`, 'admin1');
  const unknown = await world.ask('GET', '/t/repositories/987654', 'admin1');
  expect(removed.statusCode).toBe(404);
  expect(shapeOf(removed)).toEqual(shapeOf(unknown));
  expect(world.reached).toEqual([]);
});

test("another tenant's repository is a 404 for the admin of tenant 2, and its own is theirs", async () => {
  const world = await guardWorld();
  expect((await world.ask('GET', `/t/repositories/${world.repositories.t1r1}`, 'admin2')).statusCode).toBe(404);
  expect((await world.ask('GET', `/t/repositories/${world.repositories.t2r1}`, 'admin2')).statusCode).toBe(200);
  expect((await world.ask('GET', `/t/repositories/${world.repositories.t2r1}`, 'admin1')).statusCode).toBe(404);
});

test('a request with no session is 401 on every tenant route, and nothing is read for it', async () => {
  const world = await guardWorld();
  const before = world.queries.length;
  const answers = await Promise.all([
    world.ask('GET', `/t/installations/${world.tenants.t1}`),
    world.ask('GET', `/t/repositories/${world.repositories.t1r1}`),
    world.ask('GET', '/t/installations/abc'),
  ]);
  expect(answers.map((answer) => answer.statusCode)).toEqual([401, 401, 401]);
  expect(world.queries).toHaveLength(before);
  expect(world.fake.calls).toEqual([]);
  expect(world.reached).toEqual([]);
});

test.each([
  ['a word', 'abc'],
  ['zero', '0'],
  ['a negative number', '-1'],
  ['a fraction', '1.5'],
  ['an exponent', '1e3'],
  ['a leading zero', '007'],
  ['a plus sign', '+7'],
  ['more than a number holds exactly', '9007199254740993'],
  ['a hexadecimal number', '0x10'],
])('%s as :installationId is a 400 for a signed-in viewer, with nothing read', async (_name, value) => {
  const world = await guardWorld();
  // What a request that only needs the session costs: the lookup of the session and nothing else.
  const session = await world.statementsOf('/probe/protected', 'outsider');
  const before = world.queries.length;
  const answer = await world.ask('GET', `/t/installations/${encodeURIComponent(value)}`, 'outsider');
  expect(answer.statusCode).toBe(400);
  expect(answer.json()).toEqual({
    error: { code: 'bad_request', message: 'Bad Request', requestId: answer.headers['x-request-id'] },
  });
  expect(world.queries.length - before).toBe(session);
  expect(world.reached).toEqual([]);
});

test('a HEAD request meets the guard of its GET route', async () => {
  const world = await guardWorld();
  const url = `/t/installations/${world.tenants.t1}`;
  const denied = await world.app.inject({ method: 'HEAD', url, headers: { cookie: world.people.outsider.cookie } });
  const allowed = await world.app.inject({ method: 'HEAD', url, headers: { cookie: world.people.admin1.cookie } });
  expect([denied.statusCode, allowed.statusCode]).toEqual([404, 200]);
});

test('no denial of an installation call changes a row of any tenant table', async () => {
  const world = await guardWorld();
  const before = await tenantTables(world.db);
  await Promise.all(Object.values(causesOfNotFound(world)));
  expect(await tenantTables(world.db)).toBe(before);
});
