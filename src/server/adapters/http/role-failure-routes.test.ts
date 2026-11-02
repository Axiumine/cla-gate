// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { VIEWER_ID } from '../../services/role-fixture/test-support.ts';
import { rolesWorld, tenantRow } from '../../services/role-lookups-fixture/test-support.ts';
import { authWorld } from './auth-fixture/test-support.ts';
import { requireAuth } from './auth-request.ts';

// What a client sees when the role of the caller cannot be learned (E11-S04), through the real application: a probe route
// that asks the cached role lookups, as the tenant guard of E11-S05 will, and a GitHub that fails on demand.

const PARAMS = z.object({ n: z.coerce.number() });

/** The app, a signed-in viewer (numeric id 501) and a route that answers whether the viewer is an admin of tenant `n`. */
async function world() {
  const auth = await authWorld();
  const roles = rolesWorld(40);
  for (let n = 1; n <= 40; n += 1) {
    roles.setOrgRole(n, 'admin');
  }
  // The route of a mode asks the lookups of that mode, as the tenant guard of E11-S05 will: `read` may use the cache.
  const routes = [
    ['/probe/org/:n', roles.lookups.read],
    ['/probe/write/org/:n', roles.lookups.write],
  ] as const;
  for (const [path, lookups] of routes) {
    auth.app.get(path, { config: { access: 'authenticated' } }, async (request) => {
      const { user } = requireAuth(request);
      const { n } = PARAMS.parse(request.params);
      const viewer = { githubId: user.githubId, login: 'alice' };
      return { admin: await lookups.orgAdmin(tenantRow(n), viewer) };
    });
  }
  const alice = await auth.login(VIEWER_ID);
  const probe = (n: number) => auth.app.inject({ url: `/probe/org/${n}`, headers: { cookie: alice.cookie } });
  const probeWrite = (n: number) =>
    auth.app.inject({ url: `/probe/write/org/${n}`, headers: { cookie: alice.cookie } });
  return { ...auth, roles, probe, probeWrite };
}

test('the probe answers the role when GitHub does', async () => {
  const { probe } = await world();
  const response = await probe(1);
  expect([response.statusCode, response.json()]).toEqual([200, { admin: true }]);
});

test('an outage is 502 github_unavailable in the standard body, and the answer is not an empty or a none role', async () => {
  const { probe, roles } = await world();
  roles.fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
  const response = await probe(1);
  expect(response.statusCode).toBe(502);
  expect(response.headers['retry-after']).toBeUndefined();
  const body = errorResponseSchema.parse(response.json());
  expect(body.error).toMatchObject({ code: 'github_unavailable', message: 'Bad Gateway' });
  expect(Object.keys(response.json())).toEqual(['error']);
});

test.each([
  [90, '90'],
  [300, '300'],
  [301, '300'],
  [86_400, '300'],
])('a rate limit of %s s is 503 github_rate_limited with retry-after %s', async (asked, header) => {
  const { probe, roles } = await world();
  roles.fake.failNext('getOrgMembership', new GitHubRateLimitedError(asked, 'secondary'));
  const response = await probe(1);
  expect(response.statusCode).toBe(503);
  expect(response.headers['retry-after']).toBe(header);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({
    code: 'github_rate_limited',
    message: 'Service Unavailable',
  });
});

test('the failure is not kept: the next request, once GitHub is back, gets the role', async () => {
  const { probe, roles } = await world();
  roles.fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
  expect((await probe(1)).statusCode).toBe(502);
  const next = await probe(1);
  expect([next.statusCode, next.json()]).toEqual([200, { admin: true }]);
});

test('the 31st uncached lookup of the viewer in a minute is 429 too_many_requests with retry-after, over 31 installations', async () => {
  const { probe, roles } = await world();
  for (let n = 1; n <= 30; n += 1) {
    expect((await probe(n)).statusCode).toBe(200);
  }
  const refused = await probe(31);
  expect(refused.statusCode).toBe(429);
  expect(refused.headers['retry-after']).toBe('60');
  expect(errorResponseSchema.parse(refused.json()).error).toMatchObject({
    code: 'too_many_requests',
    message: 'Too Many Requests',
  });
  expect(roles.fake.calls).toHaveLength(30);
  roles.clock.advance(60_000);
  expect((await probe(31)).statusCode).toBe(200);
});

test('an installation already in the cache is still served to a viewer who is over the limit', async () => {
  const { probe } = await world();
  for (let n = 1; n <= 30; n += 1) {
    await probe(n);
  }
  expect((await probe(31)).statusCode).toBe(429);
  expect((await probe(5)).statusCode).toBe(200);
});

test('a failure of GitHub is logged as a warning with the status and the code, with no stack and no person', async () => {
  const { probe, roles, logs } = await world();
  roles.fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
  await probe(1);
  const rejected = logs.lines().filter((line) => line['msg'] === 'request rejected');
  expect(rejected).toMatchObject([{ level: 40, statusCode: 502, code: 'github_unavailable' }]);
  expect(logs.lines().filter((line) => line['msg'] === 'unhandled error')).toEqual([]);
  expect(logs.text()).not.toMatch(/alice|login-501|org-1/);
});

test('an error that is not one of these is still the plain 500 with nothing of its own', async () => {
  const { probe, roles } = await world();
  roles.fake.failNext('getOrgMembership', new Error('something else broke'));
  const response = await probe(1);
  expect(response.statusCode).toBe(500);
  expect(response.headers['retry-after']).toBeUndefined();
  expect(response.body).not.toContain('something else broke');
});

test('a write route sees a demoted admin at once, a read route may see the old role for up to 60 s', async () => {
  const { probe, probeWrite, roles } = await world();
  expect((await probe(1)).json()).toEqual({ admin: true });
  roles.setOrgRole(1, 'member');
  roles.clock.advance(30_000);
  expect((await probe(1)).json()).toEqual({ admin: true });
  expect((await probeWrite(1)).json()).toEqual({ admin: false });
  expect((await probe(1)).json()).toEqual({ admin: false });
});

test('a write route whose lookup fails is 502 even where a read route is served from the cache', async () => {
  const { probe, probeWrite, roles } = await world();
  await probe(1);
  roles.fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
  expect((await probeWrite(1)).statusCode).toBe(502);
  expect((await probe(1)).statusCode).toBe(200);
});
