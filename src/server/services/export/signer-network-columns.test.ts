// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { dropNetworkColumns } from '../../adapters/db/network-metadata-fixture/test-support.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { signerNetworkColumns } from './signer-network-columns.ts';

// Which optional network columns of signer_pii exist (E16-S06): both after migration 014 (E13-S05), and the lookup still tells
// when one or both are missing, as in a database from before it.

test('a migrated database has both columns', async () => {
  const { db } = await migratedTestDatabase();
  expect(await signerNetworkColumns(db)).toEqual({ ipAddress: true, userAgent: true });
});

test('a database from before migration 014 has neither column', async () => {
  const { db } = await migratedTestDatabase();
  await dropNetworkColumns(db);
  expect(await signerNetworkColumns(db)).toEqual({ ipAddress: false, userAgent: false });
});

test.each([
  ['the address only', 'user_agent', { ipAddress: true, userAgent: false }],
  ['the user agent only', 'ip_address', { ipAddress: false, userAgent: true }],
])('with %s the lookup finds just that column (the other was dropped)', async (_label, dropped, expected) => {
  const { db } = await migratedTestDatabase();
  await sql`alter table signer_pii drop column ${sql.id(dropped)}`.execute(db);
  expect(await signerNetworkColumns(db)).toEqual(expected);
});
