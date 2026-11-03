// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { INSTALLATIONS_PATH, installationListSchema } from '../../../shared/installations.ts';
import { scopeDocuments } from '../../services/discovery-fixture/test-support.ts';
import { id } from '../../services/github-contract/test-support.ts';
import {
  GitHubRateLimitedError,
  GitHubUnavailableError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
} from '../../services/ports/github-errors.ts';
import { bodyOf, failureOf, storeRepositories } from './installation-list-fixture/test-support.ts';
import { guardWorld } from './tenant-guard-fixture/test-support.ts';

// What GET /api/installations answers when a role cannot be had (E14-S01): never an empty list, which would read as "you
// administer nothing". The failures are those of E11-S04 and carry the same codes and headers.

test('GitHub failing to say whether the person is an org admin is a 502, not an empty list', async () => {
  const world = await guardWorld();
  world.fake.failNext('getOrgMembership', new GitHubUnavailableError('down'));
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'admin1');
  expect(failureOf(response)).toEqual([502, 'github_unavailable']);
});

test('GitHub limiting the installation is a 503 github_rate_limited with its wait in retry-after', async () => {
  const world = await guardWorld();
  world.fake.failNext('getOrgMembership', new GitHubRateLimitedError(42, 'primary'));
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'admin1');
  expect(failureOf(response)).toEqual([503, 'github_rate_limited']);
  expect(response.headers['retry-after']).toBe('42');
});

test('a failing look for a repository admin is a 502 too: the person may administer a repository, and the answer is not "none"', async () => {
  const world = await guardWorld();
  world.fake.failNext('getRepositoryPermission', new GitHubUnavailableError('down'));
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'repoAdmin1');
  expect(failureOf(response)).toEqual([502, 'github_unavailable']);
});

test('an installation GitHub stopped serving under the lookup is left out of the list, and the others are still listed', async () => {
  const world = await guardWorld();
  world.fake.failNext('getOrgMembership', new InstallationSuspendedError(id(100)));
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'admin1');
  expect([response.statusCode, bodyOf(response, installationListSchema)]).toEqual([200, []]);
  const admin2 = await world.ask('GET', INSTALLATIONS_PATH, 'admin2');
  expect(bodyOf(admin2, installationListSchema).map((row) => row.id)).toEqual([world.tenants.t2]);
});

test('the same for an installation the gate refuses while a repository admin is looked for', async () => {
  const world = await guardWorld();
  world.fake.failNext('getRepositoryPermission', new InstallationNotAdmittedError('suspended'));
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'repoAdmin1');
  expect([response.statusCode, bodyOf(response, installationListSchema)]).toEqual([200, []]);
});

test('a person who needs more than their 30 uncached lookups a minute is 429 with the wait, not a short list', async () => {
  const world = await guardWorld();
  const names = Array.from({ length: 35 }, (_unused, index) => `org-2/many-${String(index).padStart(2, '0')}`);
  await storeRepositories(world, { n: 2, installationId: world.tenants.t2 }, names);
  await scopeDocuments(world.db, world.tenants.t2, names);
  const response = await world.ask('GET', INSTALLATIONS_PATH, 'outsider');
  expect(failureOf(response)).toEqual([429, 'too_many_requests']);
  expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
});
