// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { tenantChecksums, twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { createDocument } from './cla-document-changes.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// The kind a document is created with (E12-S01, E21-S02). The corporate kind is on since E21-S02, so the refusal `kind_not_supported`
// is shown with the switch (`isKindSupported`) answering no for it: the one thing this file replaces, the rest of the module is real.

vi.mock('../../shared/cla.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/cla.ts')>();
  return { ...actual, isKindSupported: (kind: string) => kind === 'individual' };
});

test('a kind the switch has off is a kind_not_supported rule error and nothing is stored', async () => {
  const { db } = await migratedTestDatabase();
  const { t1 } = await twoTenants(db);
  const before = await tenantChecksums(db);
  await expect(
    createDocument(db, { installationId: t1.installationId }, parseGithubId(31_001), {
      name: 'Corporate',
      kind: 'corporate',
      repositoryId: null,
    }),
  ).rejects.toThrow(new ClaRuleError('kind_not_supported'));
  expect(await tenantChecksums(db)).toEqual(before);
});
