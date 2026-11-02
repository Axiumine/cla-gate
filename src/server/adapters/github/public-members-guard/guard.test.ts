// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { GITHUB_API_ORIGIN } from '../github-http.ts';
import { PublicMembersGuard } from './test-support.ts';

// The guard that keeps the public-members endpoints out of the platform (E07-S10) has to stop what it says it stops, and
// let the rest through, or the tests that carry it prove less than they say.

const guard = new PublicMembersGuard();
const server = setupServer(guard.handler);
// Nothing else is served, and a request nobody handles is an error: no test here reaches the network.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  guard.hits.length = 0;
});
afterAll(() => {
  server.close();
});

test.each([
  ['the list of public members', '/orgs/acme/public_members'],
  ['the check of one person', '/orgs/acme/public_members/alice'],
  ['the list asked page by page', '/orgs/acme/public_members?per_page=100&page=2'],
])('%s is answered with a network error, noted, and fails the guard', async (_name, path) => {
  await expect(fetch(`${GITHUB_API_ORIGIN}${path}`)).rejects.toThrow();
  expect(guard.hits).toHaveLength(1);
  expect(() => {
    guard.assertUnused();
  }).toThrow(/public-members endpoints are never used/);
});

test('the check of a person records the method and the path and nothing of the query', async () => {
  await expect(fetch(`${GITHUB_API_ORIGIN}/orgs/acme/public_members/alice?x=secret`)).rejects.toThrow();
  expect(guard.hits).toEqual(['GET /orgs/acme/public_members/alice']);
});

test.each([
  ['the membership of one person', '/orgs/acme/memberships/alice'],
  ['the members of an organisation', '/orgs/acme/members'],
  ['a name that only starts like the endpoint', '/orgs/acme/public_members_of_others'],
])('%s is not an endpoint it guards: the guard does not see it and stays unused', async (_name, path) => {
  await expect(fetch(`${GITHUB_API_ORIGIN}${path}`)).rejects.toThrow();
  expect(guard.hits).toEqual([]);
  expect(() => {
    guard.assertUnused();
  }).not.toThrow();
});
