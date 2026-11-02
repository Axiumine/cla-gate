// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { after, countSessions, HOUR, sessionsWorld, T0 } from './sessions-fixture/test-support.ts';
import { seedSignature, seedTenant } from './test-support.ts';

// The verified addresses captured at login (E10-S01): personal data that lives exactly as long as the session row.

const ADDRESSES = [
  { email: 'primary@example.test', primary: true },
  { email: 'second@example.test', primary: false },
];

test('the verified addresses given at creation are stored as they were reported, with their primary flag', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice, verifiedEmails: ADDRESSES }, T0);
  expect(await store.verifiedEmails(created.rowId)).toEqual(ADDRESSES);
  const row = await db.selectFrom('sessions').select('verified_emails').executeTakeFirstOrThrow();
  expect(row.verified_emails).toEqual(ADDRESSES);
});

test('a session created without addresses holds an empty list', async () => {
  const { store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice }, T0);
  expect(await store.verifiedEmails(created.rowId)).toEqual([]);
});

test('twenty addresses are stored, and a session that is not there has none', async () => {
  const { store, alice } = await sessionsWorld();
  const twenty = Array.from({ length: 20 }, (_, index) => ({ email: `a${index}@example.test`, primary: index === 3 }));
  const created = await store.create({ userId: alice, verifiedEmails: twenty }, T0);
  expect(await store.verifiedEmails(created.rowId)).toEqual(twenty);
  expect(await store.verifiedEmails(created.rowId + 1000)).toEqual([]);
});

test("one person's addresses are not read through another session", async () => {
  const { store, alice, bob } = await sessionsWorld();
  const mine = await store.create({ userId: alice, verifiedEmails: ADDRESSES }, T0);
  const theirs = await store.create(
    { userId: bob, verifiedEmails: [{ email: 'bob@example.test', primary: true }] },
    T0,
  );
  expect(await store.verifiedEmails(mine.rowId)).toEqual(ADDRESSES);
  expect(await store.verifiedEmails(theirs.rowId)).toEqual([{ email: 'bob@example.test', primary: true }]);
});

test('the addresses go with the row when a dead session is found', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create({ userId: alice, verifiedEmails: ADDRESSES }, T0);
  await store.findLive(created.id, after(9 * HOUR));
  expect(await store.verifiedEmails(created.rowId)).toEqual([]);
  expect(await countSessions(db)).toBe(0);
});

test('the addresses go with the row when the creation of another session purges it', async () => {
  const { db, store, alice, bob } = await sessionsWorld();
  await store.create({ userId: bob, verifiedEmails: ADDRESSES }, T0);
  await store.create({ userId: alice }, after(9 * HOUR));
  const remaining = await sql<{ n: number }>`
    select count(*)::int as n from sessions where verified_emails::text like '%example.test%'`.execute(db);
  expect(remaining.rows).toEqual([{ n: 0 }]);
});

test("erasing a person deletes every session of theirs with the addresses in it, and nobody else's", async () => {
  const { db, store, alice, bob } = await sessionsWorld();
  const tenant = await seedTenant(db, 7);
  const signer = await seedSignature(db, tenant, 3003);
  await store.create({ userId: signer.userId, verifiedEmails: ADDRESSES }, T0);
  await store.create({ userId: signer.userId, verifiedEmails: ADDRESSES }, after(HOUR));
  const bobs = await store.create({ userId: bob, verifiedEmails: [{ email: 'bob@example.test', primary: true }] }, T0);
  await store.create({ userId: alice }, T0);

  await sql`select erase_signer_pii(3003, 9999)`.execute(db);

  const left = await sql<{ user_id: number }>`select user_id from sessions order by id`.execute(db);
  expect(left.rows.map((row) => row.user_id)).toEqual([bob, alice]);
  expect(await store.verifiedEmails(bobs.rowId)).toEqual([{ email: 'bob@example.test', primary: true }]);
  const text = await sql<{ found: boolean }>`
    select bool_or(verified_emails::text like '%primary@example.test%') as found from sessions`.execute(db);
  expect(text.rows).toEqual([{ found: false }]);
});
