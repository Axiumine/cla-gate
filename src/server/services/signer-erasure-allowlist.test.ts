// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { listAccount, sharedSigner, snapshots } from '../adapters/db/erasure-fixture/test-support.ts';
import { migratedTestDatabase, seedTenant } from '../adapters/db/test-support.ts';
import { eraseSigner, erasureCounts } from './signer-erasure.ts';
import { holdsAnythingAbout } from './signer-erasure-counts.ts';
import { SignerNotFoundError } from './signer-erasure-errors.ts';
import { ACTOR } from './test-support.ts';

// The erasure of an allowlisted account that never signed (E14-S06): the tenant holds a login snapshot for it and no signature,
// so the person is found by their entry and the erasure clears the snapshot.

const BOT = parseGithubId(555);

test.each([
  [{ signatures: 0, signerPiiRows: 0, allowlistEntries: 0 }, false],
  [{ signatures: 1, signerPiiRows: 0, allowlistEntries: 0 }, true],
  [{ signatures: 0, signerPiiRows: 0, allowlistEntries: 1 }, true],
  [{ signatures: 2, signerPiiRows: 1, allowlistEntries: 3 }, true],
])('the tenant holds something about a person with the counts %j: %s', (counts, expected) => {
  expect(holdsAnythingAbout(counts)).toBe(expected);
});

test('the counts include the allowlist entries of this tenant for the person, and no other tenant', async () => {
  const { db } = await migratedTestDatabase();
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  await listAccount(db, t1, 555, 'ada');
  await listAccount(db, t2, 555, 'ada');
  await listAccount(db, t2, 556, null);
  expect(await erasureCounts(db, t1, BOT)).toEqual({ signatures: 0, signerPiiRows: 0, allowlistEntries: 1 });
  expect(await erasureCounts(db, t1, parseGithubId(556))).toEqual({
    signatures: 0,
    signerPiiRows: 0,
    allowlistEntries: 0,
  });
});

test("an allowlisted account that never signed is erased: the snapshot is cleared in the tenant, the entry stays, and the audit row is the tenant's", async () => {
  const { db } = await migratedTestDatabase();
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  await listAccount(db, t1, 555, 'ada');
  await listAccount(db, t2, 555, 'ada');

  expect(await eraseSigner(db, t1, { githubUserId: BOT, expectedRows: 0, actor: ACTOR })).toBe(0);

  expect(await snapshots(db)).toEqual([
    { installation_id: t1.installationId, github_id: 555, login_snapshot: null },
    { installation_id: t2.installationId, github_id: 555, login_snapshot: 'ada' },
  ]);
  expect(
    await db.selectFrom('audit_log').select(['installation_id', 'actor_github_id', 'action', 'subject_id']).execute(),
  ).toEqual([
    { installation_id: t1.installationId, actor_github_id: ACTOR, action: 'signer_pii.erased', subject_id: BOT },
  ]);
});

test('an account the tenant knows nothing of is not found even when another tenant lists it, and a person who signed elsewhere only is the same', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2 } = await sharedSigner(db, 111);
  const t3 = await seedTenant(db, 3);
  await listAccount(db, t2, 555, 'ada');

  await expect(eraseSigner(db, t1, { githubUserId: BOT, expectedRows: 0, actor: ACTOR })).rejects.toBeInstanceOf(
    SignerNotFoundError,
  );
  await expect(
    eraseSigner(db, t3, { githubUserId: parseGithubId(111), expectedRows: 1, actor: ACTOR }),
  ).rejects.toBeInstanceOf(SignerNotFoundError);

  expect(await snapshots(db)).toEqual([{ installation_id: t2.installationId, github_id: 555, login_snapshot: 'ada' }]);
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
});
