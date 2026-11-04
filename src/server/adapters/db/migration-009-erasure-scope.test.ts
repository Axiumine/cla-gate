// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  insertSignature,
  publishSecondMajor,
  type Signer,
  sharedSigner,
  storePii,
} from './erasure-fixture/test-support.ts';
import type { Database } from './schema.ts';
import { containing, migratedTestDatabase, seedSignature, seedTenant } from './test-support.ts';

// The scope of erase_signer_pii (E16-S04): the installation it is given decides what it removes. A person who signed in two
// tenants is erased for one of them and stays a signer of the other.

const ERASE = (githubId: number, installationId: number) =>
  sql<{ erased: number }>`select erase_signer_pii(${githubId}, ${9999}, ${installationId}) as erased`;

const piiOwners = async (db: Kysely<Database>): Promise<number[]> => {
  const rows = await db
    .selectFrom('signer_pii as p')
    .innerJoin('signatures as s', 's.id', 'p.signature_id')
    .select('s.installation_id')
    .orderBy('p.signature_id')
    .execute();
  return rows.map((row) => row.installation_id);
};

const addSession = (db: Kysely<Database>, signer: Signer, hash: string) =>
  db
    .insertInto('sessions')
    .values({
      session_hash: hash.repeat(64),
      user_id: signer.userId,
      csrf_secret: 'csrf',
      idle_expires_at: new Date(Date.now() + 60_000),
      absolute_expires_at: new Date(Date.now() + 120_000),
    })
    .execute();

test("erasing through one tenant deletes what that tenant holds and leaves the other tenant's data, the snapshot and the sessions", async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2, person } = await sharedSigner(db);
  await addSession(db, person, 'a');

  expect((await ERASE(person.githubId, t1.installationId).execute(db)).rows).toEqual([{ erased: 1 }]);

  expect(await piiOwners(db)).toEqual([t2.installationId]);
  const user = await db
    .selectFrom('users')
    .select(['login', 'name', 'avatar_url'])
    .where('github_id', '=', person.githubId)
    .executeTakeFirstOrThrow();
  expect(user).toEqual({ login: 'login-111', name: 'Name 111', avatar_url: 'https://avatars.example/u' });
  expect(await db.selectFrom('sessions').select('user_id').execute()).toEqual([{ user_id: person.userId }]);
  const audit = await db.selectFrom('audit_log').select(['installation_id', 'metadata']).execute();
  expect(audit).toEqual([{ installation_id: t1.installationId, metadata: { signer_pii_rows: 1 } }]);
});

test('erasing through the last tenant that holds personal data scrubs the snapshot and ends the sessions', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2, person } = await sharedSigner(db);
  await addSession(db, person, 'a');
  await ERASE(person.githubId, t1.installationId).execute(db);

  expect((await ERASE(person.githubId, t2.installationId).execute(db)).rows).toEqual([{ erased: 1 }]);

  expect(await piiOwners(db)).toEqual([]);
  const user = await db
    .selectFrom('users')
    .select(['login', 'name', 'avatar_url'])
    .where('github_id', '=', person.githubId)
    .executeTakeFirstOrThrow();
  expect(user).toEqual({ login: 'erased-111', name: null, avatar_url: null });
  expect(await db.selectFrom('sessions').select('user_id').execute()).toEqual([]);
  const audit = await db.selectFrom('audit_log').select('installation_id').orderBy('id').execute();
  expect(audit).toEqual([{ installation_id: t1.installationId }, { installation_id: t2.installationId }]);
});

test('erasing through a tenant where the person signed nothing deletes and scrubs nothing and still leaves its audit row', async () => {
  const { db } = await migratedTestDatabase();
  const t1 = await seedTenant(db, 1);
  const t2 = await seedTenant(db, 2);
  const signer = await seedSignature(db, t2, 111);
  await addSession(db, { userId: signer.userId, githubId: 111 }, 'a');

  expect((await ERASE(111, t1.installationId).execute(db)).rows).toEqual([{ erased: 0 }]);

  expect(await piiOwners(db)).toEqual([t2.installationId]);
  expect(await db.selectFrom('users').select('login').where('github_id', '=', 111).execute()).toEqual([
    { login: 'login-111' },
  ]);
  expect(await db.selectFrom('sessions').select('id').execute()).toHaveLength(1);
  expect(await db.selectFrom('audit_log').select(['installation_id', 'metadata']).execute()).toEqual([
    { installation_id: t1.installationId, metadata: { signer_pii_rows: 0 } },
  ]);
});

test('erasure leaves every signature row byte for byte as it was, in every tenant', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2, person } = await sharedSigner(db);
  const snapshot = () =>
    sql<{ row: unknown }>`select to_jsonb(s) as row from signatures as s order by s.id`.execute(db);
  const before = (await snapshot()).rows;
  expect(before).toHaveLength(2);

  await ERASE(person.githubId, t1.installationId).execute(db);
  await ERASE(person.githubId, t2.installationId).execute(db);

  expect((await snapshot()).rows).toEqual(before);
});

test('the login snapshot of the allowlist entries of the person in that installation is cleared, and no other', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2, person } = await sharedSigner(db);
  const entry = (installationId: number, createdBy: number, githubId: number) => {
    const snapshot = `snapshot-${githubId}`;
    return sql`insert into allowlist_entries (installation_id, kind, github_id, created_by, login_snapshot)
        values (${installationId}, 'user', ${githubId}, ${createdBy}, ${snapshot})`.execute(db);
  };
  await entry(t1.installationId, t1.publisherId, person.githubId);
  await entry(t2.installationId, t2.publisherId, person.githubId);
  await entry(t1.installationId, t1.publisherId, 222);

  await ERASE(person.githubId, t1.installationId).execute(db);

  const { rows } = await sql<{ installation_id: number; github_id: number; login_snapshot: string | null }>`
    select installation_id, github_id, login_snapshot from allowlist_entries order by installation_id, github_id`.execute(
    db,
  );
  expect(rows).toEqual([
    { installation_id: t1.installationId, github_id: 111, login_snapshot: null },
    { installation_id: t1.installationId, github_id: 222, login_snapshot: 'snapshot-222' },
    { installation_id: t2.installationId, github_id: 111, login_snapshot: 'snapshot-111' },
  ]);
});

test('personal data of a signature in another tenant can still be stored after an erasure through this one; one of this tenant cannot', async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2, person, secondSignatureId } = await sharedSigner(db);
  const inFlightHere = await insertSignature(db, t1, person, await publishSecondMajor(db, t1));
  const inFlightThere = await insertSignature(db, t2, person, await publishSecondMajor(db, t2));

  await ERASE(person.githubId, t1.installationId).execute(db);

  await expect(storePii(db, inFlightHere, person)).rejects.toMatchObject({
    code: '23001',
    message: containing('erased'),
  });
  await storePii(db, inFlightThere, person);
  expect(await db.selectFrom('signer_pii').select('signature_id').orderBy('signature_id').execute()).toEqual([
    { signature_id: secondSignatureId },
    { signature_id: inFlightThere },
  ]);
});

test('an audit row of an erasure without an installation, as the earlier function wrote, still blocks the personal data of every tenant', async () => {
  const { db } = await migratedTestDatabase();
  const { t2, person } = await sharedSigner(db);
  const pending = await insertSignature(db, t2, person, await publishSecondMajor(db, t2));
  await db
    .insertInto('audit_log')
    .values({
      installation_id: null,
      actor_github_id: 9999,
      action: 'signer_pii.erased',
      subject_type: 'user',
      subject_id: person.githubId,
      metadata: JSON.stringify({ signer_pii_rows: 2 }),
    })
    .execute();

  await expect(storePii(db, pending, person)).rejects.toMatchObject({ code: '23001' });
});
