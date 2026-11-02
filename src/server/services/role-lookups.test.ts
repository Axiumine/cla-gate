// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { FastifyContextConfig } from 'fastify';
import { expect, expectTypeOf, test } from 'vitest';
import { GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';
import { ProbeBudget, ProbeBudgetExhaustedError } from './probe-budget.ts';
import { tenantId, userInstallation, VIEWER } from './role-fixture/test-support.ts';
import type { RoleLookupMode } from './role-lookups.ts';
import { githubInstallationOf, repositoryRow, rolesWorld, tenantRow } from './role-lookups-fixture/test-support.ts';

// The role lookups with the role cache in front of them (E11-S04), over the in-memory GitHub of E05-S04: what a read and a
// write see after a demotion, what a hit costs, and that a failure is never an answer. The single flight over the real
// adapter is in adapters/github/role-cache-single-flight.test.ts, the per-person limit in role-lookups-limit.test.ts.

/** How many calls reached GitHub for the membership of the viewer. */
const membershipCalls = (fake: { calls: readonly { method: string }[] }): number =>
  fake.calls.filter((call) => call.method === 'getOrgMembership').length;

test('a read is served from the cache: GitHub is asked once for the same person and installation', async () => {
  const { fake, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'admin');
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(fake.calls).toEqual([{ method: 'getOrgMembership', installationId: githubInstallationOf(1) }]);
});

test('a negative answer is served from the cache too', async () => {
  const { fake, lookups } = rolesWorld();
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(false);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(false);
  expect(membershipCalls(fake)).toBe(1);
});

test('a write sees a demoted admin at once, while a read may still see the old role for up to 60 s', async () => {
  const { clock, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'admin');
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  setOrgRole(1, 'member');
  clock.advance(10_000);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(await lookups.write.orgAdmin(tenantRow(1), VIEWER)).toBe(false);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(false);
});

test('without a write in between, the read sees the demotion when its answer is 60 s old', async () => {
  const { clock, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'admin');
  await lookups.read.orgAdmin(tenantRow(1), VIEWER);
  setOrgRole(1, 'member');
  clock.advance(59_999);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  clock.advance(1);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(false);
});

test('a write asks GitHub every time and what it learns is what the next read gets', async () => {
  const { fake, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'member');
  expect(await lookups.write.orgAdmin(tenantRow(1), VIEWER)).toBe(false);
  setOrgRole(1, 'admin');
  expect(await lookups.write.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(membershipCalls(fake)).toBe(2);
});

test('the same person is asked of each installation with its own token and kept under its own key', async () => {
  const { fake, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'admin');
  setOrgRole(2, 'member');
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(await lookups.read.orgAdmin(tenantRow(2), VIEWER)).toBe(false);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(fake.calls.map((call) => call.installationId)).toEqual([githubInstallationOf(1), githubInstallationOf(2)]);
});

test.each([
  ['unavailable', () => new GitHubUnavailableError('GitHub is down')],
  ['rate limited', () => new GitHubRateLimitedError(90, 'primary')],
])('GitHub %s is thrown, never an answer, and the next read asks again', async (_name, failure) => {
  const { fake, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'admin');
  fake.failNext('getOrgMembership', failure());
  await expect(lookups.read.orgAdmin(tenantRow(1), VIEWER)).rejects.toBeInstanceOf(failure().constructor);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(membershipCalls(fake)).toBe(2);
});

test('after the 60 s a failing GitHub fails the read; the old answer is not served in its place', async () => {
  const { clock, fake, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'admin');
  await lookups.read.orgAdmin(tenantRow(1), VIEWER);
  clock.advance(60_000);
  fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
  await expect(lookups.read.orgAdmin(tenantRow(1), VIEWER)).rejects.toBeInstanceOf(GitHubUnavailableError);
});

test('a write whose lookup fails fails too, though a read would have been served the old answer', async () => {
  const { fake, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'admin');
  await lookups.read.orgAdmin(tenantRow(1), VIEWER);
  fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
  await expect(lookups.write.orgAdmin(tenantRow(1), VIEWER)).rejects.toBeInstanceOf(GitHubUnavailableError);
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
});

test('a user installation is decided by comparing ids: no GitHub call, nothing kept, nothing counted against the person', async () => {
  const { cache, fake, lookups } = rolesWorld();
  const own = { ...userInstallation(1001, VIEWER.githubId), id: tenantId(1) };
  const other = { ...userInstallation(1002, VIEWER.githubId + 1), id: tenantId(2) };
  expect(await lookups.read.orgAdmin(own, VIEWER)).toBe(true);
  expect(await lookups.write.orgAdmin(other, VIEWER)).toBe(false);
  expect([fake.calls, cache.size]).toEqual([[], 0]);
});

test('the repository fact is kept per repository by its numeric GitHub id, and the probe is spent only by a miss', async () => {
  const { fake, lookups, setRepoPermission } = rolesWorld();
  setRepoPermission(1, 1, 'admin');
  setRepoPermission(1, 2, 'write');
  const budget = new ProbeBudget(10);
  const ask = (index: number) => lookups.read.repoAdmin(tenantRow(1), repositoryRow(1, index), VIEWER, budget);
  expect([await ask(1), await ask(2), await ask(1), await ask(2), await ask(1)]).toEqual([
    true,
    false,
    true,
    false,
    true,
  ]);
  expect(budget.remaining).toBe(8);
  expect(fake.calls.filter((call) => call.method === 'getRepositoryPermission')).toHaveLength(2);
});

test('an empty probe budget ends the lookup before GitHub is asked, and the failure is not kept', async () => {
  const { fake, lookups, setRepoPermission } = rolesWorld();
  setRepoPermission(1, 1, 'admin');
  const empty = new ProbeBudget(0);
  await expect(lookups.read.repoAdmin(tenantRow(1), repositoryRow(1, 1), VIEWER, empty)).rejects.toBeInstanceOf(
    ProbeBudgetExhaustedError,
  );
  expect(fake.calls).toEqual([]);
  expect(await lookups.read.repoAdmin(tenantRow(1), repositoryRow(1, 1), VIEWER, new ProbeBudget(1))).toBe(true);
});

test('a write sees a repository demotion at once and a read keeps the old answer for up to 60 s', async () => {
  const { lookups, setRepoPermission } = rolesWorld();
  setRepoPermission(1, 1, 'admin');
  const repo = repositoryRow(1, 1);
  expect(await lookups.read.repoAdmin(tenantRow(1), repo, VIEWER)).toBe(true);
  setRepoPermission(1, 1, 'write');
  expect(await lookups.read.repoAdmin(tenantRow(1), repo, VIEWER)).toBe(true);
  expect(await lookups.write.repoAdmin(tenantRow(1), repo, VIEWER)).toBe(false);
  expect(await lookups.read.repoAdmin(tenantRow(1), repo, VIEWER)).toBe(false);
});

test('the org fact and the repository fact of one installation are kept apart', async () => {
  const { cache, lookups, setOrgRole, setRepoPermission } = rolesWorld();
  setOrgRole(1, 'member');
  setRepoPermission(1, 1, 'admin');
  expect(await lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(false);
  expect(await lookups.read.repoAdmin(tenantRow(1), repositoryRow(1, 1), VIEWER)).toBe(true);
  expect(cache.size).toBe(2);
});

test('after the cache forgets the person, the next lookup asks GitHub again', async () => {
  const { cache, fake, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'admin');
  await lookups.read.orgAdmin(tenantRow(1), VIEWER);
  cache.invalidateViewer(VIEWER.githubId);
  await lookups.read.orgAdmin(tenantRow(1), VIEWER);
  expect(membershipCalls(fake)).toBe(2);
});

test('twenty simultaneous reads ask GitHub once and spend one lookup of the person', async () => {
  const { fake, lookups, setOrgRole } = rolesWorld();
  setOrgRole(1, 'admin');
  const answers = await Promise.all(Array.from({ length: 20 }, () => lookups.read.orgAdmin(tenantRow(1), VIEWER)));
  expect(answers).toEqual(Array.from({ length: 20 }, () => true));
  expect(membershipCalls(fake)).toBe(1);
});

test('the modes are the modes of a tenant route declaration', () => {
  type Declared = Extract<NonNullable<FastifyContextConfig['access']>, { kind: 'tenant' }>['mode'];
  expectTypeOf<RoleLookupMode>().toEqualTypeOf<Declared>();
});
