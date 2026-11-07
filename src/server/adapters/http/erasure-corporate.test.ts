// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { erasurePreviewSchema } from '../../../shared/erasure.ts';
import { corporateTenant, PEOPLE } from '../db/corporate-fixture/test-support.ts';
import { erasureWorld } from './erasure-fixture/test-support.ts';

// The erasure routes for a person a corporate agreement approves and who never signed (E21-S03): tenant 1's agreement approves the employee,
// who has no signature, no user row and no allowlist entry, so the admin of tenant 1 can see and erase the login snapshot kept with the approval.

test('the preview counts the approval of the employee, with no signature and no row of personal data, and tenant 2 knows nothing of them', async () => {
  const { preview, db, t1, t2 } = await erasureWorld();
  await corporateTenant(db, t1, t1.signer.githubId);
  const response = await preview('admin1', t1.installationId, `?githubUserId=${PEOPLE.employee}`);
  expect(response.statusCode).toBe(200);
  expect(erasurePreviewSchema.parse(response.json())).toEqual({
    githubUserId: PEOPLE.employee,
    signatures: 0,
    signerPiiRows: 0,
    allowlistEntries: 0,
    corporateApprovals: 1,
  });
  expect((await preview('admin2', t2.installationId, `?githubUserId=${PEOPLE.employee}`)).statusCode).toBe(404);
});

test('the erasure deletes the login snapshot of the approval, keeps the approval, answers 0 rows, and leaves the other tenant’s snapshot', async () => {
  const { erase, db, t1, t2 } = await erasureWorld();
  await corporateTenant(db, t1, t1.signer.githubId);
  await corporateTenant(db, t2, t2.signer.githubId);
  const response = await erase('admin1', t1.installationId, { githubUserId: PEOPLE.employee, expectedRows: 0 });
  expect([response.statusCode, response.json()]).toEqual([200, { erasedRows: 0 }]);
  const kept = await db
    .selectFrom('corporate_approval_pii as p')
    .innerJoin('corporate_approvals as a', 'a.id', 'p.approval_id')
    .select(['a.installation_id', 'p.login'])
    .where('a.subject_github_id', '=', PEOPLE.employee)
    .where('a.kind', '=', 'user')
    .execute();
  expect(kept).toEqual([{ installation_id: t2.installationId, login: 'employee-login' }]);
  const approvals = await db
    .selectFrom('corporate_approvals')
    .select('installation_id')
    .where('subject_github_id', '=', PEOPLE.employee)
    .orderBy('installation_id')
    .execute();
  expect(approvals.map((row) => row.installation_id)).toEqual([t1.installationId, t2.installationId]);
});
