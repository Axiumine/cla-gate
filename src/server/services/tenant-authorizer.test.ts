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
  const ask = (requirement: 'org_admin' | 'repo_admin' = 'org_admin', mode: 'read' | 'write' = 'read') =>
    authorize({
      mode,
      requirement,
      installation: world.a.installation,
      repository: null,
      viewer: VIEWER,
      active: true,
    });
  /** The same question once the installation is away: suspended, so GitHub refuses its tokens and no role can be asked. */
  const askAway = (mode: 'read' | 'write' = 'read') =>
    authorize({
      mode,
      requirement: 'org_admin',
      installation: { ...world.a.installation, suspended_at: new Date('2026-11-01T00:00:00.000Z') },
      repository: null,
      viewer: VIEWER,
      active: false,
    });
  const ledger = () => world.db.selectFrom('installation_admin_seen').select('user_github_id').execute();
  return { ...world, fake, cache, ask, askAway, ledger };
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

test('an org admin a live lookup saw is remembered: once the installation is away they are allowed, with no call to GitHub', async () => {
  const { ask, askAway, fake, ledger } = await setup();
  fake.addMembership(id(100), 'org-1', 'alice', { state: 'active', role: 'admin', userId: id(VIEWER_ID) });
  expect(await askAway()).toEqual({ decision: 'not_found' });
  await ask();
  expect(await ledger()).toEqual([{ user_github_id: VIEWER_ID }]);
  const asked = fake.calls.length;
  expect(await askAway()).toEqual({ decision: 'allow', role: 'org_admin' });
  expect(fake.calls).toHaveLength(asked);
});

test('a live negative result forgets the admin: a write asks GitHub again, finds a member, and the entry goes', async () => {
  const { ask, askAway, fake, ledger } = await setup();
  fake.addMembership(id(100), 'org-1', 'alice', { state: 'active', role: 'admin', userId: id(VIEWER_ID) });
  await ask();
  expect(await ledger()).toHaveLength(1);
  fake.addMembership(id(100), 'org-1', 'alice', { state: 'active', role: 'member', userId: id(VIEWER_ID) });
  expect(await ask('org_admin', 'write')).toEqual({ decision: 'not_found' });
  expect(await ledger()).toEqual([]);
  expect(await askAway()).toEqual({ decision: 'not_found' });
});

test('a lookup that fails leaves the ledger as it was: no entry is added and none is removed', async () => {
  const { ask, fake, ledger } = await setup();
  fake.addMembership(id(100), 'org-1', 'alice', { state: 'active', role: 'admin', userId: id(VIEWER_ID) });
  await ask();
  fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
  await expect(ask('org_admin', 'write')).rejects.toBeInstanceOf(GitHubUnavailableError);
  expect(await ledger()).toEqual([{ user_github_id: VIEWER_ID }]);
});
