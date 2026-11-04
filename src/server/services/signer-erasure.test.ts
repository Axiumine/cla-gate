// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import {
  insertSignature,
  publishSecondMajor,
  sharedSigner,
  storePii,
} from '../adapters/db/erasure-fixture/test-support.ts';
import { tenantChecksums } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase, seedSignature, seedTenant } from '../adapters/db/test-support.ts';
import { eraseSigner, erasureCounts } from './signer-erasure.ts';
import { ErasureCountChangedError, SignerNotFoundError } from './signer-erasure-errors.ts';
import { ACTOR } from './test-support.ts';

// The erasure of one signer in one tenant (E16-S04): what is counted, what is removed, and the refusals that leave
// everything as it was. The HTTP side is in adapters/http/erasure-*.test.ts.

const PERSON = parseGithubId(111);

/** The state an erasure may change: the personal data, the display snapshot, the sessions and the audit log. */
async function personalState(db: Awaited<ReturnType<typeof migratedTestDatabase>>['db']) {
  return {
    tenants: await tenantChecksums(db),
    users: (await sql`select login, name, avatar_url from users order by id`.execute(db)).rows,
    sessions: (await sql`select user_id from sessions order by id`.execute(db)).rows,
  };
}

test('the counts are the signatures the tenant holds for the person and the rows of personal data kept for them, and no other tenant', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2 } = await sharedSigner(db);
  await seedSignature(db, t1, 222);
  expect(await erasureCounts(db, t1, PERSON)).toEqual({ signatures: 1, signerPiiRows: 1, allowlistEntries: 0 });
  expect(await erasureCounts(db, t2, PERSON)).toEqual({ signatures: 1, signerPiiRows: 1, allowlistEntries: 0 });
  expect(await erasureCounts(db, t1, parseGithubId(222))).toEqual({
    signatures: 1,
    signerPiiRows: 1,
    allowlistEntries: 0,
  });
  expect(await erasureCounts(db, t2, parseGithubId(222))).toEqual({
    signatures: 0,
    signerPiiRows: 0,
    allowlistEntries: 0,
  });
  expect(await erasureCounts(db, t1, parseGithubId(987_654))).toEqual({
    signatures: 0,
    signerPiiRows: 0,
    allowlistEntries: 0,
  });
});

test('a signature whose personal data was erased still counts as a signature and no longer as a row', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2 } = await sharedSigner(db);
  await eraseSigner(db, t1, { githubUserId: PERSON, expectedRows: 1, actor: ACTOR });
  expect(await erasureCounts(db, t1, PERSON)).toEqual({ signatures: 1, signerPiiRows: 0, allowlistEntries: 0 });
  expect(await erasureCounts(db, t2, PERSON)).toEqual({ signatures: 1, signerPiiRows: 1, allowlistEntries: 0 });
});

test('the erasure returns the number of rows it deleted, leaves the signatures and writes one audit row of the tenant with the admin', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, person } = await sharedSigner(db);
  const signatures = () => sql`select to_jsonb(s) as row from signatures as s order by s.id`.execute(db);
  const before = (await signatures()).rows;

  expect(await eraseSigner(db, t1, { githubUserId: PERSON, expectedRows: 1, actor: ACTOR })).toBe(1);

  expect((await signatures()).rows).toEqual(before);
  expect(await db.selectFrom('signer_pii').select('user_id').execute()).toEqual([{ user_id: person.userId }]);
  expect(
    await db.selectFrom('audit_log').select(['installation_id', 'actor_github_id', 'action', 'subject_id']).execute(),
  ).toEqual([
    { installation_id: t1.installationId, actor_github_id: ACTOR, action: 'signer_pii.erased', subject_id: PERSON },
  ]);
});

test('a person with signatures of two majors has all their rows in the tenant erased in one go', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, person } = await sharedSigner(db);
  await storePii(db, await insertSignature(db, t1, person, await publishSecondMajor(db, t1)), person);
  expect(await erasureCounts(db, t1, PERSON)).toEqual({ signatures: 2, signerPiiRows: 2, allowlistEntries: 0 });

  expect(await eraseSigner(db, t1, { githubUserId: PERSON, expectedRows: 2, actor: ACTOR })).toBe(2);
  expect(await erasureCounts(db, t1, PERSON)).toEqual({ signatures: 2, signerPiiRows: 0, allowlistEntries: 0 });
});

test('a person with no signature in the tenant is not found, even when they signed in another tenant, and nothing changes', async () => {
  const { db } = await migratedTestDatabase();
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  await seedSignature(db, t2, 111);
  const before = await personalState(db);

  await expect(eraseSigner(db, t1, { githubUserId: PERSON, expectedRows: 0, actor: ACTOR })).rejects.toBeInstanceOf(
    SignerNotFoundError,
  );
  await expect(
    eraseSigner(db, t1, { githubUserId: parseGithubId(987_654), expectedRows: 0, actor: ACTOR }),
  ).rejects.toBeInstanceOf(SignerNotFoundError);

  expect(await personalState(db)).toEqual(before);
});

test.each([
  ['fewer rows than there are', 0],
  ['more rows than there are', 2],
])(
  'an erasure that expects %s is refused with the count changed, and the transaction leaves nothing behind',
  async (_name, expectedRows) => {
    const { db } = await migratedTestDatabase();
    const { t1, person } = await sharedSigner(db);
    await db
      .insertInto('sessions')
      .values({
        session_hash: 'a'.repeat(64),
        user_id: person.userId,
        csrf_secret: 'csrf',
        idle_expires_at: new Date(Date.now() + 60_000),
        absolute_expires_at: new Date(Date.now() + 120_000),
      })
      .execute();
    const before = await personalState(db);

    await expect(eraseSigner(db, t1, { githubUserId: PERSON, expectedRows, actor: ACTOR })).rejects.toBeInstanceOf(
      ErasureCountChangedError,
    );

    expect(await personalState(db)).toEqual(before);
    expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
  },
);

test("the erasure runs in the caller's transaction: when the caller rolls back, the personal data is still there", async () => {
  const { db } = await migratedTestDatabase();
  const { t1 } = await sharedSigner(db);
  await expect(
    db.transaction().execute(async (trx) => {
      expect(await eraseSigner(trx, t1, { githubUserId: PERSON, expectedRows: 1, actor: ACTOR })).toBe(1);
      expect(await erasureCounts(trx, t1, PERSON)).toEqual({ signatures: 1, signerPiiRows: 0, allowlistEntries: 0 });
      throw new Error('the caller gives up');
    }),
  ).rejects.toThrow('the caller gives up');
  expect(await erasureCounts(db, t1, PERSON)).toEqual({ signatures: 1, signerPiiRows: 1, allowlistEntries: 0 });
});

test('the errors say what happened in words that carry no personal data', () => {
  expect(new SignerNotFoundError().message).toBe('the person has no signature and no allowlist entry in this tenant');
  expect(new ErasureCountChangedError().message).toBe('the rows of personal data changed since the preview');
  expect([new SignerNotFoundError().name, new ErasureCountChangedError().name]).toEqual([
    'SignerNotFoundError',
    'ErasureCountChangedError',
  ]);
});
