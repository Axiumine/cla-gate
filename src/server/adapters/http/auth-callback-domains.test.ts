// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ALICE, callbackWorld } from './callback-fixture/test-support.ts';

// GET /api/auth/callback (E21-S04): the new session keeps the domains of the verified addresses, and nothing else of them but what E10-S05 kept.

test('the new session holds the distinct lower-cased domains of the verified addresses, and no address among them', async () => {
  const world = await callbackWorld();
  world.github.account = {
    ...ALICE,
    emails: [
      { email: 'Alice@ACME.com', primary: true, verified: true },
      { email: 'alice.work@acme.com', primary: false, verified: true },
      { email: 'alice@Bücher.example', primary: false, verified: true },
      { email: 'alice@unverified.example', primary: false, verified: false },
    ],
  };
  await world.signIn();
  const row = await world.db
    .selectFrom('sessions')
    .select(['verified_emails', 'verified_email_domains'])
    .executeTakeFirstOrThrow();
  expect(row.verified_email_domains).toEqual(['acme.com', 'xn--bcher-kva.example']);
  expect(JSON.stringify(row.verified_email_domains)).not.toContain('@');
  expect(JSON.stringify(row.verified_emails)).toContain('Alice@ACME.com');
});

test('an account with no verified address gets a session with no domains', async () => {
  const world = await callbackWorld();
  world.github.account = { ...ALICE, emails: [{ email: 'alice@acme.com', primary: true, verified: false }] };
  await world.signIn();
  const row = await world.db.selectFrom('sessions').select('verified_email_domains').executeTakeFirstOrThrow();
  expect(row.verified_email_domains).toEqual([]);
});

test('a login replaces the domains of the session it ends, so the old ones are not carried over', async () => {
  const world = await callbackWorld();
  const old = await world.login(ALICE.id);
  await world.db
    .updateTable('sessions')
    .set({ verified_email_domains: ['old.example'] })
    .execute();
  await world.signIn({ session: old.cookie });
  const rows = await world.db.selectFrom('sessions').select('verified_email_domains').execute();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.verified_email_domains).toEqual(['example.org']);
});
