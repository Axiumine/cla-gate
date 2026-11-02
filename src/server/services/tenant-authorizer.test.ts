// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { githubOfTwoTenants, scopeDocuments } from './discovery-fixture/test-support.ts';
import { id } from './github-contract/test-support.ts';
import { GitHubUnavailableError } from './ports/github-errors.ts';
import { RoleCache } from './role-cache.ts';
import { VIEWER, VIEWER_ID } from './role-fixture/test-support.ts';
import { worldOfTwoTenants } from './store-fixture/test-support.ts';
import { createTenantAuthorizer, roleGitHubNotWired } from './tenant-authorizer.ts';
import { FakeClock } from './test-support.ts';

// The tenant authorisation wired to what it reads (E11-S05): the real lookups, the cache that is given, the database for
// the discovery. The decisions themselves are in tenant-authorization.test.ts.

async function setup() {
  const world = await worldOfTwoTenants();
  const fake = githubOfTwoTenants();
  const cache = new RoleCache({ clock: new FakeClock('2026-11-02T10:00:00.000Z') });
  const log = createLogger({ logLevel: 'info' }, captureLogs().destination);
  const authorize = createTenantAuthorizer({
    db: world.db,
    github: fake,
    cache,
    clock: new FakeClock('2026-11-02T10:00:00.000Z'),
    log,
  });
  const ask = (requirement: 'org_admin' | 'repo_admin' = 'org_admin') =>
    authorize({
      mode: 'read',
      requirement,
      installation: world.a.installation,
      repository: null,
      viewer: VIEWER,
      active: true,
    });
  return { ...world, fake, cache, ask };
}

test('an org admin of the stored installation is allowed, asked of GitHub by the numeric id of the installation', async () => {
  const { ask, fake } = await setup();
  fake.addMembership(id(100), 'org-1', 'alice', { state: 'active', role: 'admin', userId: id(VIEWER_ID) });
  expect(await ask()).toEqual({ decision: 'allow', role: 'org_admin' });
  expect(fake.calls).toEqual([{ method: 'getOrgMembership', installationId: id(100) }]);
});

test('a viewer who is admin of a repository with a repo-scoped document is forbidden: the discovery reads the database', async () => {
  const { ask, fake, db, a } = await setup();
  await scopeDocuments(db, a.installation.id, ['org-1/repo-2']);
  fake.addRepositoryPermission(id(100), 'org-1/repo-2', 'alice', { permission: 'admin', userId: id(VIEWER_ID) });
  expect(await ask()).toEqual({ decision: 'forbidden' });
});

test('a viewer with no role is not_found, and the other tenant is never probed', async () => {
  const { ask, fake, db, a, b } = await setup();
  await scopeDocuments(db, a.installation.id, ['org-1/repo-1']);
  await scopeDocuments(db, b.installation.id, ['org-2/repo-1']);
  expect(await ask()).toEqual({ decision: 'not_found' });
  expect(fake.calls.filter((call) => call.installationId === id(200))).toEqual([]);
});

test('the answers are kept in the cache that was given, so forgetting the viewer there makes the next call ask again', async () => {
  const { ask, fake, cache } = await setup();
  fake.addMembership(id(100), 'org-1', 'alice', { state: 'active', role: 'admin', userId: id(VIEWER_ID) });
  await ask();
  await ask();
  expect(fake.calls).toHaveLength(1);
  cache.invalidateViewer(VIEWER_ID);
  await ask();
  expect(fake.calls).toHaveLength(2);
});

test('a server with no GitHub App fails every role call as an outage, with a fixed message', async () => {
  const outage = (call: Promise<unknown>) => call.catch((error: unknown) => error);
  const failures = [
    await outage(roleGitHubNotWired.getOrgMembership(id(100), 'org-1', 'alice')),
    await outage(roleGitHubNotWired.getRepositoryPermission(id(100), 'org-1', 'repo-1', 'alice')),
  ];
  for (const failure of failures) {
    expect(failure).toBeInstanceOf(GitHubUnavailableError);
    expect(failure).toMatchObject({ message: 'no GitHub App is configured: roles cannot be read' });
  }
});

test('with no GitHub App an organisation is never allowed, and the owner of a user account still is', async () => {
  const world = await worldOfTwoTenants();
  const clock = new FakeClock('2026-11-02T10:00:00.000Z');
  const log = createLogger({ logLevel: 'info' }, captureLogs().destination);
  const authorize = createTenantAuthorizer({
    db: world.db,
    github: roleGitHubNotWired,
    cache: new RoleCache({ clock }),
    clock,
    log,
  });
  const question = { mode: 'read', requirement: 'org_admin', repository: null, viewer: VIEWER, active: true } as const;
  await expect(authorize({ ...question, installation: world.a.installation })).rejects.toBeInstanceOf(
    GitHubUnavailableError,
  );
  const owned = { ...world.a.installation, account_type: 'User', account_id: VIEWER_ID } as const;
  expect(await authorize({ ...question, installation: owned })).toEqual({ decision: 'allow', role: 'org_admin' });
});
