// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from './schema.ts';
import { migratedTestDatabase, seedSignature, seedTenant } from './test-support.ts';

// The index of the list of a person's own signatures (E13-S06, migration 015): its columns in the order of the list, that it
// is neither partial nor unique, and that adding it left the signature core as immutable as before.

/** The definition of the index as the catalogue writes it. */
async function indexDefinition(db: Kysely<Database>): Promise<string> {
  const { rows } = await sql<{ indexdef: string }>`
    select indexdef from pg_indexes
    where schemaname = current_schema() and tablename = 'signatures' and indexname = 'signatures_user_signed_at_idx'`.execute(
    db,
  );
  expect(rows).toHaveLength(1);
  return rows[0]?.indexdef ?? '';
}

test('the index covers the person, the instant and the id, the last two newest first, as the list orders its pages', async () => {
  const { db } = await migratedTestDatabase();
  expect(await indexDefinition(db)).toMatch(/\(user_id, signed_at DESC, id DESC\)$/u);
});

test('the index is not partial and not unique, so revoked signatures are in it and two signatures of one instant are allowed', async () => {
  const { db } = await migratedTestDatabase();
  expect(await indexDefinition(db)).not.toMatch(/UNIQUE| WHERE /u);
});

test('a signature is still refused an update and a delete with the index in place', async () => {
  const { db } = await migratedTestDatabase();
  const { signatureId } = await seedSignature(db, await seedTenant(db), 111);
  await expect(db.updateTable('signatures').set({ major: 9 }).where('id', '=', signatureId).execute()).rejects.toThrow(
    /immutable|not allowed|cannot/iu,
  );
  await expect(db.deleteFrom('signatures').where('id', '=', signatureId).execute()).rejects.toThrow(
    /immutable|not allowed|cannot/iu,
  );
});
