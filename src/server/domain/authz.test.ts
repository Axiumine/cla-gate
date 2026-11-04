// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, expectTypeOf, test } from 'vitest';
import { type Decision, decide, type Requirement, type RoleFacts } from './authz.ts';

// The decision table of E11-S01, spelled out row by row: the expected answers are written here from the story and the role
// matrix, not computed from the code under test. Two requirements and three facts make 16 combinations; the third requirement,
// `any_role` (E14-S01, the call that any role in the installation may make), adds 8.

type Row = readonly [Requirement, RoleFacts, Decision];

const facts = (orgAdmin: boolean, repoAdmin: boolean, hasRoleInInstallation: boolean): RoleFacts => ({
  orgAdmin,
  repoAdmin,
  hasRoleInInstallation,
});

const TABLE: readonly Row[] = [
  // org_admin: only an org admin passes; a repository admin or anyone else with a role here is forbidden.
  ['org_admin', facts(false, false, false), 'not_found'],
  ['org_admin', facts(false, false, true), 'forbidden'],
  ['org_admin', facts(false, true, false), 'forbidden'],
  ['org_admin', facts(false, true, true), 'forbidden'],
  ['org_admin', facts(true, false, false), 'allow'],
  ['org_admin', facts(true, false, true), 'allow'],
  ['org_admin', facts(true, true, false), 'allow'],
  ['org_admin', facts(true, true, true), 'allow'],
  // repo_admin: an org admin or an admin of the repository passes; anyone else with a role here is forbidden.
  ['repo_admin', facts(false, false, false), 'not_found'],
  ['repo_admin', facts(false, false, true), 'forbidden'],
  ['repo_admin', facts(false, true, false), 'allow'],
  ['repo_admin', facts(false, true, true), 'allow'],
  ['repo_admin', facts(true, false, false), 'allow'],
  ['repo_admin', facts(true, false, true), 'allow'],
  ['repo_admin', facts(true, true, false), 'allow'],
  ['repo_admin', facts(true, true, true), 'allow'],
  // any_role: an org admin, an admin of a repository or anyone the discovery found a role for passes; nobody else is told anything.
  ['any_role', facts(false, false, false), 'not_found'],
  ['any_role', facts(false, false, true), 'allow'],
  ['any_role', facts(false, true, false), 'allow'],
  ['any_role', facts(false, true, true), 'allow'],
  ['any_role', facts(true, false, false), 'allow'],
  ['any_role', facts(true, false, true), 'allow'],
  ['any_role', facts(true, true, false), 'allow'],
  ['any_role', facts(true, true, true), 'allow'],
];

test('the table has all 24 combinations of three requirements and three facts, each once', () => {
  const keys = TABLE.map(([requirement, f]) => [requirement, f.orgAdmin, f.repoAdmin, f.hasRoleInInstallation].join());
  expect(TABLE).toHaveLength(24);
  expect(new Set(keys).size).toBe(24);
});

test.each(TABLE)('%s with %j gives %s', (requirement, given, expected) => {
  expect(decide(requirement, given)).toBe(expected);
});

test('decide cannot be called with an unknown requirement: the parameter is the three names and nothing else', () => {
  expectTypeOf<Parameters<typeof decide>[0]>().toEqualTypeOf<'org_admin' | 'repo_admin' | 'any_role'>();
  expectTypeOf(decide).returns.toEqualTypeOf<'allow' | 'forbidden' | 'not_found'>();
  // @ts-expect-error -- the type-level test itself: 'owner' is not a requirement, so this call must not compile
  expect(() => decide('owner', facts(true, true, true))).not.toThrow();
});

test.each(['owner', 'ORG_ADMIN', ' org_admin', ''])(
  'the unknown requirement %j is denied with not_found, even for a viewer who is every kind of admin',
  (requirement) => {
    // @ts-expect-error -- a value that is not a requirement must not compile; it is passed anyway to prove the run-time default is a denial
    expect(decide(requirement, facts(true, true, true))).toBe('not_found');
  },
);
