// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { scopeDocuments } from '../../services/discovery-fixture/test-support.ts';
import { id } from '../../services/github-contract/test-support.ts';
import { createInstallationStore } from '../../services/installation-store.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { listed } from '../../services/store-fixture/test-support.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { guardWorld, PEOPLE } from './tenant-guard-fixture/test-support.ts';
import { byInstallationParam } from './tenant-resolvers.ts';

// When GitHub cannot say what a person may do, the guard does not guess (E11-S05): the call fails with the status of
// E11-S04 and nothing runs. And what the guard costs GitHub: a role is read once a minute, a write asks again, a stranger
// costs at most 10 probes.

const membershipCalls = (world: Awaited<ReturnType<typeof guardWorld>>) =>
  world.fake.calls.filter((call) => call.method === 'getOrgMembership').length;

test.each(['GET', 'POST'] as const)(
  'an outage of GitHub is 502 github_unavailable for a %s, never an allow, and the handler does not run',
  async (method) => {
    const world = await guardWorld();
    world.fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
    const answer = await world.ask(method, `/t/installations/${world.tenants.t1}`, 'admin1');
    expect(answer.statusCode).toBe(502);
    expect(answer.headers['retry-after']).toBeUndefined();
    expect(answer.json()).toEqual({
      error: { code: 'github_unavailable', message: 'Bad Gateway', requestId: answer.headers['x-request-id'] },
    });
    expect(world.reached).toEqual([]);
  },
);

test('a rate limit of GitHub is 503 github_rate_limited with its wait as retry-after', async () => {
  const world = await guardWorld();
  world.fake.failNext('getOrgMembership', new GitHubRateLimitedError(90, 'secondary'));
  const answer = await world.ask('GET', `/t/installations/${world.tenants.t1}`, 'admin1');
  expect([answer.statusCode, answer.headers['retry-after']]).toEqual([503, '90']);
  expect(answer.json()).toMatchObject({ error: { code: 'github_rate_limited' } });
  expect(world.reached).toEqual([]);
});

test('a probe that fails on the denial path is 502, not the 404 of "no role": the outage is not an answer', async () => {
  const world = await guardWorld();
  world.fake.failNext('getRepositoryPermission', new GitHubUnavailableError('GitHub is down'));
  const answer = await world.ask('GET', `/t/installations/${world.tenants.t1}`, 'outsider');
  expect(answer.statusCode).toBe(502);
  expect(world.reached).toEqual([]);
});

test('the failure is not kept: the next request, once GitHub is back, is served', async () => {
  const world = await guardWorld();
  world.fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
  const url = `/t/installations/${world.tenants.t1}`;
  expect((await world.ask('GET', url, 'admin1')).statusCode).toBe(502);
  expect((await world.ask('GET', url, 'admin1')).statusCode).toBe(200);
});

test('a read uses the cached role and a write asks GitHub again every time', async () => {
  const world = await guardWorld();
  const url = `/t/installations/${world.tenants.t1}`;
  await world.ask('GET', url, 'admin1');
  await world.ask('GET', url, 'admin1');
  expect(membershipCalls(world)).toBe(1);
  await world.ask('POST', url, 'admin1');
  await world.ask('POST', url, 'admin1');
  expect(membershipCalls(world)).toBe(3);
});

test('a write sees a demoted admin at once, a read may see the old role for up to 60 seconds', async () => {
  const world = await guardWorld();
  const url = `/t/installations/${world.tenants.t1}`;
  const status = async (method: 'GET' | 'POST') => (await world.ask(method, url, 'admin1')).statusCode;
  expect(await status('GET')).toBe(200);
  world.fake.addMembership(id(100), 'org-1', `login-${PEOPLE.admin1}`, {
    state: 'active',
    role: 'member',
    userId: id(PEOPLE.admin1),
  });
  world.advance(30);
  expect(await status('GET')).toBe(200);
  expect(await status('POST')).toBe(404);
  // The write replaced the cached answer, so the read knows now too.
  expect(await status('GET')).toBe(404);
});

test('a stranger costs at most 10 probes of GitHub per installation, and the repeat costs none', async () => {
  const world = await guardWorld();
  const store = createInstallationStore(world.db);
  const more = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  await store.upsertRepositories(
    world.tenants.t1,
    more.map((index) => listed(1, index)),
  );
  await scopeDocuments(
    world.db,
    world.tenants.t1,
    more.map((index) => `org-1/repo-${index}`),
  );
  const url = `/t/installations/${world.tenants.t1}`;
  const probes = () => world.fake.calls.filter((call) => call.method === 'getRepositoryPermission').length;
  expect((await world.ask('GET', url, 'outsider')).statusCode).toBe(404);
  expect(probes()).toBe(10);
  expect((await world.ask('GET', url, 'outsider')).statusCode).toBe(404);
  expect(probes()).toBe(10);
});

test('the 31st uncached lookup of a person in a minute is 429 too_many_requests with retry-after', async () => {
  const world = await guardWorld();
  const url = `/t/installations/${world.tenants.t1}`;
  // Every write asks GitHub again, so every one of them costs the person one lookup of their thirty.
  const answers: Awaited<ReturnType<typeof world.ask>>[] = [];
  for (let attempt = 0; attempt < 35; attempt += 1) {
    answers.push(await world.ask('POST', url, 'outsider'));
  }
  const refused = answers.find((answer) => answer.statusCode !== 404);
  expect(refused?.statusCode).toBe(429);
  expect(refused?.headers['retry-after']).toBe('60');
  expect(refused?.json()).toMatchObject({ error: { code: 'too_many_requests', message: 'Too Many Requests' } });
  expect(world.fake.calls.length).toBeLessThanOrEqual(30);
});

test('a strict body refuses an installationId, and the handler reads the installation from request.tenant alone', async () => {
  const world = await guardWorld();
  const access = tenantAccess({ mode: 'write', resolve: byInstallationParam(world.db) });
  world.app.post(
    '/t/installations/:installationId/notes',
    { config: { access }, schema: { body: z.strictObject({ note: z.string() }) } },
    (request) => ({ installationId: requireTenant(request).installationId }),
  );
  const url = `/t/installations/${world.tenants.t1}/notes`;
  const send = (payload: object, query = '') =>
    world.app.inject({ method: 'POST', url: url + query, headers: world.people.admin1.headers, payload });
  const refused = await send({ note: 'x', installationId: world.tenants.t2 });
  expect(refused.statusCode).toBe(400);
  const served = await send({ note: 'x' }, `?installationId=${world.tenants.t2}`);
  expect([served.statusCode, served.json()]).toEqual([200, { installationId: world.tenants.t1 }]);
});
