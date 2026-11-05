// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { after, HOUR, sessionsWorld, T0 } from './sessions-fixture/test-support.ts';
import { readVerifiedEmailDomains } from './sessions-read.ts';

// The domains of the verified addresses kept with a session (E21-S04): derived from the addresses at creation, in the stored form,
// and gone with the row.

const address = (email: string, primary = false) => ({ email, primary });

test('the domains of the addresses are stored, distinct, lower-cased and in the order they were met, and no address is among them', async () => {
  const { db, store, alice } = await sessionsWorld();
  const created = await store.create(
    {
      userId: alice,
      verifiedEmails: [
        address('Ada@ACME.com', true),
        address('ada.work@acme.com'),
        address('ada@Bücher.example'),
        address('ada@personal.example'),
      ],
    },
    T0,
  );
  const expected = ['acme.com', 'xn--bcher-kva.example', 'personal.example'];
  expect(await readVerifiedEmailDomains(db, created.rowId)).toEqual(expected);
  const row = await db.selectFrom('sessions').select('verified_email_domains').executeTakeFirstOrThrow();
  expect(row.verified_email_domains).toEqual(expected);
  expect(JSON.stringify(row.verified_email_domains)).not.toContain('@');
});

test('a session created without addresses has no domains, and an address with no usable domain adds none', async () => {
  const { db, store, alice } = await sessionsWorld();
  const none = await store.create({ userId: alice }, T0);
  expect(await readVerifiedEmailDomains(db, none.rowId)).toEqual([]);
  const odd = await store.create(
    { userId: alice, verifiedEmails: [address('ada@localhost'), address('ada@'), address('ada@192.0.2.1')] },
    T0,
  );
  expect(await readVerifiedEmailDomains(db, odd.rowId)).toEqual([]);
});

test('twenty addresses at twenty domains are all kept, and a session that is not there has none', async () => {
  const { db, store, alice } = await sessionsWorld();
  const twenty = Array.from({ length: 20 }, (_, index) => address(`a@d${index}.example`, index === 0));
  const created = await store.create({ userId: alice, verifiedEmails: twenty }, T0);
  expect(await readVerifiedEmailDomains(db, created.rowId)).toHaveLength(20);
  expect(await readVerifiedEmailDomains(db, created.rowId + 1000)).toEqual([]);
});

test("one person's domains are not read through another session, and they go with the row", async () => {
  const { db, store, alice, bob } = await sessionsWorld();
  const mine = await store.create({ userId: alice, verifiedEmails: [address('a@mine.example')] }, T0);
  const theirs = await store.create({ userId: bob, verifiedEmails: [address('b@theirs.example')] }, T0);
  expect(await readVerifiedEmailDomains(db, mine.rowId)).toEqual(['mine.example']);
  expect(await readVerifiedEmailDomains(db, theirs.rowId)).toEqual(['theirs.example']);
  await store.remove(mine.rowId);
  expect(await readVerifiedEmailDomains(db, mine.rowId)).toEqual([]);
  expect(await readVerifiedEmailDomains(db, theirs.rowId)).toEqual(['theirs.example']);
});

test('an expired session is deleted with its domains when the next one is created', async () => {
  const { db, store, alice } = await sessionsWorld();
  const old = await store.create({ userId: alice, verifiedEmails: [address('a@old.example')] }, T0);
  await store.create({ userId: alice }, after(400 * HOUR));
  expect(await readVerifiedEmailDomains(db, old.rowId)).toEqual([]);
});
