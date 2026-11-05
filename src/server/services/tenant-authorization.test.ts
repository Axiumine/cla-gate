// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import type { AdminLedger } from './admin-ledger.ts';
import type { InstallationRow } from './installation-state.ts';
import { GitHubUnavailableError } from './ports/github-errors.ts';
import type { DiscoverRepoAdminRole } from './repo-admin-discovery.ts';
import type { RepositoryRow } from './repository-rows.ts';
import { tenantId, VIEWER, VIEWER_ID } from './role-fixture/test-support.ts';
import { repositoryRow, rolesWorld, tenantRow } from './role-lookups-fixture/test-support.ts';
import { createTenantAuthorization, type TenantQuestion } from './tenant-authorization.ts';

// What a person may do in one tenant (E11-S05), over the real lookups, their cache and the in-memory GitHub. The
// role-in-installation discovery is a stub that records how it was asked: its own behaviour is E11-S03's.

const NOW = new Date('2026-11-02T10:00:00.000Z');

/** Tenant `n` as the stored row reads, admitted and active. */
function installationOf(n: number, overrides: Partial<InstallationRow> = {}): InstallationRow {
  return {
    ...tenantRow(n),
    id: tenantId(n),
    suspended_at: null,
    admission_status: 'admitted',
    admission_reason: null,
    admission_decided_at: NOW,
    deleted_at: null,
    last_synced_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

/** Repository `index` of tenant `n` as the stored row reads. */
function repositoryOf(n: number, index: number): RepositoryRow {
  const { github_repo_id, full_name, removed_at } = repositoryRow(n, index);
  return {
    id: n * 10 + index,
    installation_id: tenantId(n),
    github_repo_id,
    full_name,
    enabled: false,
    cla_document_id: null,
    public_verification: false,
    corporate_document_id: null,
    removed_at,
    created_at: NOW,
    updated_at: NOW,
  };
}

function setup(found: 'repo_admin' | 'none' = 'none') {
  const world = rolesWorld(2);
  const discover = vi.fn<DiscoverRepoAdminRole>(() => Promise.resolve({ role: found, truncated: false }));
  const ledger = { isAdmin: vi.fn<AdminLedger['isAdmin']>(() => Promise.resolve(false)) };
  const authorize = createTenantAuthorization({ lookups: world.lookups, discover, discoverForList: discover, ledger });
  const ask = (overrides: Partial<TenantQuestion> = {}) =>
    authorize({
      mode: 'read',
      requirement: 'org_admin',
      installation: installationOf(1),
      repository: null,
      viewer: VIEWER,
      active: true,
      ...overrides,
    });
  const methods = () => world.fake.calls.map((call) => call.method);
  return { ...world, discover, ledger, ask, methods };
}

test('an org admin is allowed as an org admin, with one call to GitHub and no discovery', async () => {
  const { ask, setOrgRole, methods, discover } = setup();
  setOrgRole(1, 'admin');
  expect(await ask()).toEqual({ decision: 'allow', role: 'org_admin' });
  expect(methods()).toEqual(['getOrgMembership']);
  expect(discover).not.toHaveBeenCalled();
});

test('an org admin satisfies a repository requirement without a call about the repository', async () => {
  const { ask, setOrgRole, methods } = setup();
  setOrgRole(1, 'admin');
  const answer = await ask({ requirement: 'repo_admin', repository: repositoryOf(1, 1) });
  expect(answer).toEqual({ decision: 'allow', role: 'org_admin' });
  expect(methods()).toEqual(['getOrgMembership']);
});

test('an admin of the repository is allowed as a repository admin', async () => {
  const { ask, setOrgRole, setRepoPermission, discover } = setup();
  setOrgRole(1, 'member');
  setRepoPermission(1, 1, 'admin');
  const answer = await ask({ requirement: 'repo_admin', repository: repositoryOf(1, 1) });
  expect(answer).toEqual({ decision: 'allow', role: 'repo_admin' });
  expect(discover).not.toHaveBeenCalled();
});

test('an admin of the repository who is no org admin is forbidden an installation call, with no discovery', async () => {
  const { ask, setOrgRole, setRepoPermission, discover } = setup();
  setOrgRole(1, 'member');
  setRepoPermission(1, 1, 'admin');
  expect(await ask({ repository: repositoryOf(1, 1) })).toEqual({ decision: 'forbidden' });
  expect(discover).not.toHaveBeenCalled();
});

test.each([
  ['an installation call', 'org_admin', null],
  ['a repository call', 'repo_admin', repositoryOf(1, 1)],
] as const)(
  'a viewer with no role found by the discovery is not_found for %s',
  async (_name, requirement, repository) => {
    const { ask, setOrgRole, setRepoPermission, discover, methods } = setup('none');
    setOrgRole(1, 'member');
    setRepoPermission(1, 1, 'write');
    expect(await ask({ requirement, repository })).toEqual({ decision: 'not_found' });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(methods().filter((method) => method === 'getOrgMembership')).toHaveLength(1);
  },
);

test.each([
  ['an installation call', 'org_admin', null],
  ['a repository call', 'repo_admin', repositoryOf(1, 1)],
] as const)(
  'a viewer who is admin of another repository here is forbidden %s: the discovery finds the role',
  async (_name, requirement, repository) => {
    const { ask, setOrgRole, discover } = setup('repo_admin');
    setOrgRole(1, 'member');
    expect(await ask({ requirement, repository })).toEqual({ decision: 'forbidden' });
    expect(discover).toHaveBeenCalledTimes(1);
  },
);

test('the discovery is asked for this viewer and this installation, with the small budget of the denial path', async () => {
  const { ask, discover } = setup();
  await ask();
  const [viewer, installationId, budget] = discover.mock.calls[0] ?? [];
  expect([viewer, installationId, budget?.remaining]).toEqual([VIEWER, tenantId(1), 10]);
});

test('a read uses the cached role and a write asks GitHub again', async () => {
  const { ask, setOrgRole, methods } = setup();
  setOrgRole(1, 'admin');
  await ask();
  await ask();
  expect(methods()).toEqual(['getOrgMembership']);
  await ask({ mode: 'write' });
  await ask({ mode: 'write' });
  expect(methods()).toEqual(['getOrgMembership', 'getOrgMembership', 'getOrgMembership']);
});

test('the owner of a suspended or deleted user account is allowed as an org admin with no call to GitHub', async () => {
  const { ask, methods, discover } = setup();
  const owned = { account_type: 'User', account_id: VIEWER_ID, suspended_at: NOW } as const;
  expect(await ask({ installation: installationOf(1, owned), active: false })).toEqual({
    decision: 'allow',
    role: 'org_admin',
  });
  const repoCall = { requirement: 'repo_admin', repository: repositoryOf(1, 1), active: false } as const;
  expect(await ask({ ...repoCall, installation: installationOf(1, owned) })).toEqual({
    decision: 'allow',
    role: 'org_admin',
  });
  expect(methods()).toEqual([]);
  expect(discover).not.toHaveBeenCalled();
});

test.each([
  ['somebody who does not own the user account', { account_type: 'User', account_id: 1 }],
  ['an admin of an organisation that the ledger does not know', { account_type: 'Organization' }],
] as const)(
  '%s is not_found on a suspended tenant, with no call to GitHub and no discovery',
  async (_name, overrides) => {
    const { ask, setOrgRole, methods, discover } = setup();
    setOrgRole(1, 'admin');
    const installation = installationOf(1, { ...overrides, suspended_at: NOW });
    expect(await ask({ installation, active: false })).toEqual({ decision: 'not_found' });
    expect(
      await ask({ installation, active: false, repository: repositoryOf(1, 1), requirement: 'repo_admin' }),
    ).toEqual({
      decision: 'not_found',
    });
    expect(methods()).toEqual([]);
    expect(discover).not.toHaveBeenCalled();
  },
);

test('a failure of GitHub is thrown and is neither an allow nor a denial', async () => {
  const { ask, fake, setOrgRole } = setup();
  setOrgRole(1, 'admin');
  fake.failNext('getOrgMembership', new GitHubUnavailableError('GitHub is down'));
  await expect(ask()).rejects.toBeInstanceOf(GitHubUnavailableError);
});

test('a failure of the discovery is thrown too, not turned into "no role"', async () => {
  const { ask, discover, setOrgRole } = setup();
  setOrgRole(1, 'member');
  discover.mockRejectedValueOnce(new GitHubUnavailableError('GitHub is down'));
  await expect(ask()).rejects.toBeInstanceOf(GitHubUnavailableError);
});

const SUSPENDED = { suspended_at: NOW } as const;
const DELETED = { deleted_at: NOW } as const;

test.each([
  ['suspended', SUSPENDED],
  ['deleted', DELETED],
] as const)(
  'an admin the ledger remembers is an org admin of a %s organisation for every requirement, with no call to GitHub',
  async (_state, state) => {
    const { ask, ledger, methods, discover } = setup();
    ledger.isAdmin.mockResolvedValue(true);
    const installation = installationOf(1, { account_type: 'Organization', ...state });
    expect(await ask({ installation, active: false })).toEqual({ decision: 'allow', role: 'org_admin' });
    const repoCall = {
      installation,
      active: false,
      requirement: 'repo_admin',
      repository: repositoryOf(1, 1),
    } as const;
    expect(await ask(repoCall)).toEqual({ decision: 'allow', role: 'org_admin' });
    expect(await ask({ ...repoCall, mode: 'write' })).toEqual({ decision: 'allow', role: 'org_admin' });
    expect(ledger.isAdmin).toHaveBeenCalledWith(tenantId(1), VIEWER_ID);
    expect(methods()).toEqual([]);
    expect(discover).not.toHaveBeenCalled();
  },
);

test('a repository admin is nobody on a suspended organisation, whatever GitHub would say: only an org admin passes there', async () => {
  const { ask, setOrgRole, setRepoPermission, methods, ledger } = setup('repo_admin');
  setOrgRole(1, 'member');
  setRepoPermission(1, 1, 'admin');
  const installation = installationOf(1, { account_type: 'Organization', ...SUSPENDED });
  const repoCall = { installation, active: false, requirement: 'repo_admin', repository: repositoryOf(1, 1) } as const;
  expect(await ask(repoCall)).toEqual({ decision: 'not_found' });
  expect(ledger.isAdmin).toHaveBeenCalledTimes(1);
  expect(methods()).toEqual([]);
});

test.each([
  ['an active organisation', { account_type: 'Organization' }, true],
  ['a suspended user account of somebody else', { account_type: 'User', account_id: 1, ...SUSPENDED }, false],
  ['a suspended account of another type', { account_type: 'Other', ...SUSPENDED }, false],
] as const)('the ledger is not asked about %s', async (_name, overrides, active) => {
  const { ask, setOrgRole, ledger } = setup();
  setOrgRole(1, 'member');
  ledger.isAdmin.mockResolvedValue(true);
  await ask({ installation: installationOf(1, overrides), active });
  expect(ledger.isAdmin).not.toHaveBeenCalled();
});

test('an account of another type has no admin, even for a viewer whose id is the account id', async () => {
  const { ask } = setup();
  const installation = installationOf(1, { account_type: 'Other', account_id: VIEWER_ID, ...SUSPENDED });
  expect(await ask({ installation, active: false })).toEqual({ decision: 'not_found' });
});

test('a failure of the ledger is thrown, and is neither an allow nor a denial', async () => {
  const { ask, ledger } = setup();
  ledger.isAdmin.mockRejectedValue(new Error('the database is down'));
  const installation = installationOf(1, { account_type: 'Organization', ...SUSPENDED });
  await expect(ask({ installation, active: false })).rejects.toThrow('the database is down');
});
