// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { Role } from './authz.ts';
import type { AttachedDocumentScope } from './repository-action.ts';
import { requiredRoleForDocumentChange } from './repository-document-change.ts';

// The role a change of the CLA of a repository needs (E14-S02): the document that is attached, the one that replaces it, and the
// role of the two together.

const REPOSITORY = { id: 41 };
const WIDE: AttachedDocumentScope = { scope: 'installation' };
const OWN: AttachedDocumentScope = { scope: 'repository', repositoryId: 41 };
const OTHER: AttachedDocumentScope = { scope: 'repository', repositoryId: 42 };

type Change = readonly [
  label: string,
  previous: AttachedDocumentScope | null,
  next: AttachedDocumentScope | null,
  required: Role,
];

const ATTACHES: readonly Change[] = [
  ["the organisation's document where none is attached", null, WIDE, 'org_admin'],
  ["the repository's own document where none is attached", null, OWN, 'repo_admin'],
  ["the repository's own document over its own", OWN, OWN, 'repo_admin'],
  ["the repository's own document over the organisation's", WIDE, OWN, 'org_admin'],
  ["the organisation's document over the repository's own", OWN, WIDE, 'org_admin'],
  ["the organisation's document over the organisation's", WIDE, WIDE, 'org_admin'],
  ['a document of another repository, which is never attachable', null, OTHER, 'org_admin'],
];

test.each(ATTACHES)('attaching %s needs %s', (_label, previous, next, required) => {
  expect(requiredRoleForDocumentChange(REPOSITORY, previous, next)).toBe(required);
});

const DETACHES: readonly Change[] = [
  ["the repository's own document", OWN, null, 'repo_admin'],
  ["the organisation's document", WIDE, null, 'org_admin'],
  ["nothing, so the policy that applies is the organisation's", null, null, 'org_admin'],
  ['a document of another repository, which is never attached', OTHER, null, 'org_admin'],
];

test.each(DETACHES)('detaching %s needs %s', (_label, previous, next, required) => {
  expect(requiredRoleForDocumentChange(REPOSITORY, previous, next)).toBe(required);
});
