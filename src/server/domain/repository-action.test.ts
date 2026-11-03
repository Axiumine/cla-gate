// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { Role } from './authz.ts';
import { type AttachedDocumentScope, requiredRoleForRepository, satisfiesRole } from './repository-action.ts';

// The repository-action rule (E14-S01): the role an action on a repository needs, and whether a held role is enough.

const REPOSITORY = { id: 41 };

const DOCUMENTS: readonly (readonly [string, AttachedDocumentScope | null, Role])[] = [
  ['no document', null, 'org_admin'],
  ['a document of the whole installation', { scope: 'installation' }, 'org_admin'],
  ['a document scoped to this repository', { scope: 'repository', repositoryId: 41 }, 'repo_admin'],
  ['a document scoped to another repository', { scope: 'repository', repositoryId: 42 }, 'org_admin'],
];

test.each(DOCUMENTS)('with %s the role needed is %s', (_label, document, required) => {
  expect(requiredRoleForRepository(REPOSITORY, document)).toBe(required);
});

const HELD_AGAINST_REQUIRED: readonly (readonly [Role, Role, boolean])[] = [
  ['org_admin', 'org_admin', true],
  ['org_admin', 'repo_admin', true],
  ['repo_admin', 'repo_admin', true],
  ['repo_admin', 'org_admin', false],
];

test.each(HELD_AGAINST_REQUIRED)('a %s against a requirement of %s: %s', (held, required, enough) => {
  expect(satisfiesRole(held, required)).toBe(enough);
});

// The three states of a document against both roles, as the repository list applies them to the viewer.
const VIEWER_CAN: readonly (readonly [string, AttachedDocumentScope | null, Role, boolean])[] = [
  ['no document', null, 'org_admin', true],
  ['no document', null, 'repo_admin', false],
  ['an installation-scoped document', { scope: 'installation' }, 'org_admin', true],
  ['an installation-scoped document', { scope: 'installation' }, 'repo_admin', false],
  ['a repo-scoped document', { scope: 'repository', repositoryId: 41 }, 'org_admin', true],
  ['a repo-scoped document', { scope: 'repository', repositoryId: 41 }, 'repo_admin', true],
];

test.each(VIEWER_CAN)('with %s, a %s may administer the repository: %s', (_label, document, held, may) => {
  expect(satisfiesRole(held, requiredRoleForRepository(REPOSITORY, document))).toBe(may);
});
