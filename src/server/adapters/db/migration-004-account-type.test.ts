// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { migratedTestDatabase } from './test-support.ts';

// Migration 004 (E05): an installation of an account that is neither a user nor an organisation can be stored.

const CHECK = { code: '23514' };

async function insertWithType(accountType: string) {
  const { db } = await migratedTestDatabase();
  return await sql<{
    account_type: string;
  }>`insert into installations (github_installation_id, account_id, account_login, account_type)
    values (5000, 7000, 'big-co', ${accountType}) returning account_type`
    .execute(db)
    .then((result) => result.rows[0]);
}

test.each([['Organization'], ['User'], ['Other']])('the account type %s is stored', async (accountType) => {
  expect(await insertWithType(accountType)).toEqual({ account_type: accountType });
});

test.each([['Enterprise'], ['Bot'], ['other'], ['']])(
  'the account type %j is still refused by the database',
  async (accountType) => {
    await expect(insertWithType(accountType)).rejects.toMatchObject(CHECK);
  },
);
