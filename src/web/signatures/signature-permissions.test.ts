// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { canManage } from './signature-permissions.ts';

// E18-S07: who the screen offers revocation and export to; the server decides on every request.

test.each([
  ['an org admin', 'org_admin', 'installation', true],
  ['an org admin', 'org_admin', 'repository', true],
  ['an org admin', 'org_admin', undefined, true],
  ['a repo admin', 'repo_admin', 'repository', true],
  ['a repo admin', 'repo_admin', 'installation', false],
  ['a repo admin, for a document that is only in the address', 'repo_admin', undefined, true],
  ['a person whose role is not known', undefined, 'repository', false],
  ['a person whose role is not known', undefined, 'installation', false],
  ['a person whose role is not known', undefined, undefined, false],
] as const)('%s, document of scope %s: %s', (_who, role, scope, allowed) => {
  expect(canManage(role, scope)).toBe(allowed);
});
