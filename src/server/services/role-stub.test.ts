// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { type RoleTable, StubRoleLookup } from './role-table-fixture/test-support.ts';

// The role port of the cross-tenant tests (E11-S06), answered from a table.

const id = parseGithubId;

const TABLE: RoleTable = {
  orgs: [
    { installation: id(5000), login: 'login-1', userId: id(1), role: 'admin' },
    { installation: id(5000), login: 'login-2', userId: id(2), role: 'member' },
    { installation: id(10_000), login: 'login-2', userId: id(2), role: 'admin' },
  ],
  repositories: [
    { installation: id(5000), fullName: 'org-1/scoped', login: 'login-3', userId: id(3), permission: 'admin' },
  ],
};

test('an organisation row answers with the person, their role and their numeric id, as an active membership', async () => {
  const stub = new StubRoleLookup(TABLE);
  expect(await stub.getOrgMembership(id(5000), 'org-1', 'login-1')).toEqual({
    state: 'active',
    role: 'admin',
    userId: 1,
  });
  expect(await stub.getOrgMembership(id(5000), 'org-1', 'login-2')).toEqual({
    state: 'active',
    role: 'member',
    userId: 2,
  });
});

test('the table is tenant-keyed: the same person is a member of one installation and admin of another', async () => {
  const stub = new StubRoleLookup(TABLE);
  expect((await stub.getOrgMembership(id(5000), 'org-1', 'login-2'))?.role).toBe('member');
  expect((await stub.getOrgMembership(id(10_000), 'org-2', 'login-2'))?.role).toBe('admin');
});

test('a person or an installation that is not in the table is the 404 of GitHub: null', async () => {
  const stub = new StubRoleLookup(TABLE);
  expect(await stub.getOrgMembership(id(5000), 'org-1', 'login-9')).toBeNull();
  expect(await stub.getOrgMembership(id(7777), 'org-1', 'login-1')).toBeNull();
});

test('a repository row answers with the permission and the numeric id, and only for that repository, installation and person', async () => {
  const stub = new StubRoleLookup(TABLE);
  expect(await stub.getRepositoryPermission(id(5000), 'org-1', 'scoped', 'login-3')).toEqual({
    permission: 'admin',
    userId: 3,
  });
  expect(await stub.getRepositoryPermission(id(5000), 'org-1', 'repo', 'login-3')).toBeNull();
  expect(await stub.getRepositoryPermission(id(5000), 'org-1', 'scoped', 'login-1')).toBeNull();
  expect(await stub.getRepositoryPermission(id(10_000), 'org-1', 'scoped', 'login-3')).toBeNull();
});

test('every call is recorded with its installation, target and login, in order', async () => {
  const stub = new StubRoleLookup(TABLE);
  await stub.getOrgMembership(id(5000), 'org-1', 'login-1');
  await stub.getRepositoryPermission(id(5000), 'org-1', 'scoped', 'login-3');
  expect(stub.calls).toEqual([
    'getOrgMembership 5000 org-1 login-1',
    'getRepositoryPermission 5000 org-1/scoped login-3',
  ]);
});

test('a stub with no table knows nobody, and load replaces the table', async () => {
  const stub = new StubRoleLookup();
  expect(await stub.getOrgMembership(id(5000), 'org-1', 'login-1')).toBeNull();
  expect(await stub.getRepositoryPermission(id(5000), 'org-1', 'scoped', 'login-3')).toBeNull();
  stub.load(TABLE);
  expect((await stub.getOrgMembership(id(5000), 'org-1', 'login-1'))?.role).toBe('admin');
  stub.load({ orgs: [], repositories: [] });
  expect(await stub.getOrgMembership(id(5000), 'org-1', 'login-1')).toBeNull();
});
