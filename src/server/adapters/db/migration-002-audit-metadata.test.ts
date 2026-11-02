// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { AUDIT_METADATA_KEYS } from '../../../shared/audit.ts';
import { METADATA_CASES } from '../../../shared/test-support.ts';
import { loadMigrationFiles } from './migration-files.ts';
import { MIGRATIONS_DIRECTORY, migratedRuntimeDatabase, migratedTestDatabase } from './test-support.ts';

const CHECK = { code: '23514' };

test('the database check agrees with the zod schema on every case of the shared table', async () => {
  const { db } = await migratedTestDatabase();
  for (const [name, metadata, accepted] of METADATA_CASES) {
    const json = JSON.stringify(metadata);
    const { rows } = await sql<{ clean: boolean }>`select audit_metadata_is_clean(${json}::jsonb) as clean`.execute(db);
    expect(rows[0]?.clean, name).toBe(accepted);
  }
});

test('an insert is refused by the table check exactly when the function says no', async () => {
  const { db } = await migratedTestDatabase();
  const insert = (metadata: unknown) =>
    sql`insert into audit_log (action, metadata) values ('x.y', ${JSON.stringify(metadata)}::jsonb)`.execute(db);
  await expect(
    insert({ commit_sha: 'a'.repeat(40), rows: [1, 2], account_type: 'organization' }),
  ).resolves.toBeDefined();
  await expect(insert({ email: 'alice@example.com' })).rejects.toMatchObject(CHECK);
  await expect(insert({ rows: ['alice@example.com'] })).rejects.toMatchObject(CHECK);
  await expect(insert({ kind: '203.0.113.7' })).rejects.toMatchObject(CHECK);
  await expect(insert({ state: '2001:db8::1' })).rejects.toMatchObject(CHECK);
  expect(await db.selectFrom('audit_log').select('id').execute()).toHaveLength(1);
});

test('the unprivileged runtime role can write the new keys and values', async () => {
  const { db } = await migratedRuntimeDatabase();
  await db.transaction().execute(async (trx) => {
    await sql`set local role cla_app`.execute(trx);
    await sql`insert into audit_log (action, metadata) values ('x.y', '{"webhook_deliveries": 4, "rows": [7]}')`.execute(
      trx,
    );
  });
  const row = await db.selectFrom('audit_log').select('metadata').executeTakeFirstOrThrow();
  expect(row.metadata).toEqual({ webhook_deliveries: 4, rows: [7] });
});

test('rows written under migration 001 keep their shape and the table stays append-only', async () => {
  const { db } = await migratedTestDatabase();
  await sql`insert into audit_log (action, metadata) values ('x.y', '{"count": 1}')`.execute(db);
  await expect(sql`update audit_log set metadata = '{"count": 2}'`.execute(db)).rejects.toMatchObject({
    code: '23001',
  });
});

/** The quoted keys between `array[` and `]`, from the newest migration that defines the check function. */
async function keysInNewestDefinition(): Promise<string[]> {
  const files = await loadMigrationFiles(MIGRATIONS_DIRECTORY);
  const defining = files.filter((file) => /create (?:or replace )?function audit_metadata_is_clean/i.test(file.sql));
  const list = /<> all \(\s*array\[([^\]]*)\]/.exec(defining.at(-1)?.sql ?? '')?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

test('the key list in the newest migration equals AUDIT_METADATA_KEYS, so a new key needs a new migration', async () => {
  const keys = await keysInNewestDefinition();
  expect(keys).toHaveLength(AUDIT_METADATA_KEYS.length);
  expect(new Set(keys)).toEqual(new Set(AUDIT_METADATA_KEYS));
});

test('the live function accepts each key of the constant and refuses a key next to it', async () => {
  const { db } = await migratedTestDatabase();
  for (const key of AUDIT_METADATA_KEYS) {
    const json = JSON.stringify({ [key]: 1 });
    const { rows } = await sql<{ clean: boolean }>`select audit_metadata_is_clean(${json}::jsonb) as clean`.execute(db);
    expect(rows[0]?.clean, key).toBe(true);
    const other = JSON.stringify({ [`${key}_`]: 1 });
    const refused = await sql<{ clean: boolean }>`select audit_metadata_is_clean(${other}::jsonb) as clean`.execute(db);
    expect(refused.rows[0]?.clean, `${key}_`).toBe(false);
  }
});
