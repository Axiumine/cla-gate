// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { erasurePreviewSchema } from '../../../shared/erasure.ts';
import { listAccount, snapshots } from '../db/erasure-fixture/test-support.ts';
import { dataChecksums, erasureWorld } from './erasure-fixture/test-support.ts';

// The erasure routes for an allowlisted account that never signed (E14-S06): the account is on the allowlist of tenant 1 with a
// login snapshot and has no signature and no user row, so the admin of tenant 1 can still see and erase it.

const BOT = 555;
const OTHER_TENANT_BOT = 556;

/** The snapshots of the accounts of these tests: the world lists accounts of its own too. */
async function snapshotsOfBots(db: Parameters<typeof snapshots>[0]) {
  return (await snapshots(db)).filter((row) => row.github_id === BOT || row.github_id === OTHER_TENANT_BOT);
}

test('the preview of an allowlisted account that never signed counts its entry, with no signature and no row of personal data', async () => {
  const { preview, db, t1 } = await erasureWorld();
  await listAccount(db, t1, BOT, 'ada');
  const response = await preview('admin1', t1.installationId, `?githubUserId=${BOT}`);
  expect(response.statusCode).toBe(200);
  expect(erasurePreviewSchema.parse(response.json())).toEqual({
    githubUserId: BOT,
    signatures: 0,
    signerPiiRows: 0,
    allowlistEntries: 1,
  });
});

test('the erasure of that account clears the login the allowlist shows, keeps the entry and answers 0 rows', async () => {
  const { erase, db, t1 } = await erasureWorld();
  await listAccount(db, t1, BOT, 'ada');
  const response = await erase('admin1', t1.installationId, { githubUserId: BOT, expectedRows: 0 });
  expect([response.statusCode, response.json()]).toEqual([200, { erasedRows: 0 }]);
  expect(await snapshotsOfBots(db)).toEqual([
    { installation_id: t1.installationId, github_id: BOT, login_snapshot: null },
  ]);
  expect(
    await db
      .selectFrom('audit_log')
      .select(['installation_id', 'action', 'subject_id'])
      .where('action', '=', 'signer_pii.erased')
      .execute(),
  ).toEqual([{ installation_id: t1.installationId, action: 'signer_pii.erased', subject_id: BOT }]);
});

test('an account only another tenant lists is a 404 for the admin of this tenant, on the preview and on the erasure, and nothing changes', async () => {
  const { preview, erase, db, t1, t2 } = await erasureWorld();
  await listAccount(db, t2, OTHER_TENANT_BOT, 'ada');
  const before = await dataChecksums(db);

  const seen = await preview('admin1', t1.installationId, `?githubUserId=${OTHER_TENANT_BOT}`);
  const erased = await erase('admin1', t1.installationId, { githubUserId: OTHER_TENANT_BOT, expectedRows: 0 });

  expect([seen.statusCode, erased.statusCode]).toEqual([404, 404]);
  expect(await dataChecksums(db)).toEqual(before);
  expect(await snapshotsOfBots(db)).toEqual([
    { installation_id: t2.installationId, github_id: OTHER_TENANT_BOT, login_snapshot: 'ada' },
  ]);
});
