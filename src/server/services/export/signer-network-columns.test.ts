// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { addNetworkColumns } from '../../adapters/db/network-metadata-fixture/test-support.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { signerNetworkColumns } from './signer-network-columns.ts';

// Which optional network columns of signer_pii exist (E16-S06): none before E13-S05, the two it defines after it.

test('a database without E13-S05 has neither column', async () => {
  const { db } = await migratedTestDatabase();
  expect(await signerNetworkColumns(db)).toEqual({ ipAddress: false, userAgent: false });
});

test.each([
  ['the address only', 'ip_address inet', { ipAddress: true, userAgent: false }],
  ['the user agent only', 'user_agent text', { ipAddress: false, userAgent: true }],
])('with %s the lookup finds just that column', async (_label, column, expected) => {
  const { db } = await migratedTestDatabase();
  await sql`alter table signer_pii add column ${sql.raw(column)}`.execute(db);
  expect(await signerNetworkColumns(db)).toEqual(expected);
});

test('with both columns the lookup finds both, and a dropped column is not there', async () => {
  const { db } = await migratedTestDatabase();
  await addNetworkColumns(db);
  expect(await signerNetworkColumns(db)).toEqual({ ipAddress: true, userAgent: true });
  await sql`alter table signer_pii drop column user_agent`.execute(db);
  expect(await signerNetworkColumns(db)).toEqual({ ipAddress: true, userAgent: false });
});
