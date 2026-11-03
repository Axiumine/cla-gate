// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { twoTenants } from './tenant-fixture/test-support.ts';
import {
  asRuntimeRole,
  MIGRATIONS_DIRECTORY,
  migratedRuntimeDatabase,
  migratedTestDatabase,
  seedTenant,
} from './test-support.ts';

// Migration 011 (E12-S03): the table of the drafts of a CLA text. One mutable row per document, tied to its tenant by a
// composite foreign key, and nothing of migration 001 weakened.

const CHECK = { code: '23514' };
const FOREIGN_KEY = { code: '23503' };
const UNIQUE = { code: '23505' };
const DENIED = { code: '42501' };

const RESTRICTED = z.object({ code: z.enum(['23001', '23503']) });

test('the table holds the document, its installation, the text, the revision, the person and the time, and nothing else', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>`
    select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'cla_drafts' order by ordinal_position`.execute(db);
  expect(rows).toEqual([
    { column_name: 'document_id', data_type: 'bigint', is_nullable: 'NO', column_default: null },
    { column_name: 'installation_id', data_type: 'bigint', is_nullable: 'NO', column_default: null },
    { column_name: 'content_md', data_type: 'text', is_nullable: 'NO', column_default: null },
    { column_name: 'revision', data_type: 'integer', is_nullable: 'NO', column_default: '1' },
    { column_name: 'updated_by', data_type: 'bigint', is_nullable: 'NO', column_default: null },
    { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
  ]);
});

test('the primary key is the document: a document has one draft', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ attname: string }>`
    select a.attname from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'cla_drafts'::regclass and i.indisprimary`.execute(db);
  expect(rows).toEqual([{ attname: 'document_id' }]);
  const tenant = await seedTenant(db);
  const draft = {
    document_id: tenant.documentId,
    installation_id: tenant.installationId,
    content_md: 'Draft\n',
    updated_by: tenant.publisherId,
  };
  await db.insertInto('cla_drafts').values(draft).execute();
  await expect(db.insertInto('cla_drafts').values(draft).execute()).rejects.toMatchObject(UNIQUE);
});

test('a new draft is at revision 1 and is stamped with the time of the database', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const stored = await db
    .insertInto('cla_drafts')
    .values({
      document_id: tenant.documentId,
      installation_id: tenant.installationId,
      content_md: 'Draft\n',
      updated_by: tenant.publisherId,
    })
    .returning(['revision', 'updated_at'])
    .executeTakeFirstOrThrow();
  expect(stored.revision).toBe(1);
  expect(Math.abs(stored.updated_at.getTime() - Date.now())).toBeLessThan(60_000);
});

test.each([[0], [-1]])(
  'a draft cannot be at revision %i: the database keeps the revision positive',
  async (revision) => {
    const { db } = await migratedTestDatabase();
    const tenant = await seedTenant(db);
    await expect(
      db
        .insertInto('cla_drafts')
        .values({
          document_id: tenant.documentId,
          installation_id: tenant.installationId,
          content_md: 'Draft\n',
          revision,
          updated_by: tenant.publisherId,
        })
        .execute(),
    ).rejects.toMatchObject(CHECK);
  },
);

test("a raw insert that pairs tenant 1's document with tenant 2's installation id is refused by the composite foreign key", async () => {
  const { db } = await migratedTestDatabase();
  const { t1, t2 } = await twoTenants(db);
  const attempt = db
    .insertInto('cla_drafts')
    .values({
      document_id: t1.documentId,
      installation_id: t2.installationId,
      content_md: 'Not yours\n',
      updated_by: t1.publisherId,
    })
    .execute();
  await expect(attempt).rejects.toMatchObject(FOREIGN_KEY);
  const moved = db
    .updateTable('cla_drafts')
    .set({ installation_id: t2.installationId })
    .where('document_id', '=', t1.scoped.documentId)
    .execute();
  await expect(moved).rejects.toMatchObject(FOREIGN_KEY);
  const drafts = await db
    .selectFrom('cla_drafts')
    .select(['document_id', 'installation_id'])
    .orderBy('document_id')
    .execute();
  expect(drafts).toEqual([
    { document_id: t1.scoped.documentId, installation_id: t1.installationId },
    { document_id: t2.scoped.documentId, installation_id: t2.installationId },
  ]);
});

test('a draft belongs to a document that exists and to a person who exists', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const draft = {
    document_id: tenant.documentId,
    installation_id: tenant.installationId,
    content_md: 'Draft\n',
    updated_by: tenant.publisherId,
  };
  await expect(
    db
      .insertInto('cla_drafts')
      .values({ ...draft, document_id: 987_654 })
      .execute(),
  ).rejects.toMatchObject(FOREIGN_KEY);
  await expect(
    db
      .insertInto('cla_drafts')
      .values({ ...draft, updated_by: 987_654 })
      .execute(),
  ).rejects.toMatchObject(FOREIGN_KEY);
});

test('the document and the person cannot be deleted from under a draft', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await db
    .insertInto('cla_drafts')
    .values({
      document_id: tenant.documentId,
      installation_id: tenant.installationId,
      content_md: 'Draft\n',
      updated_by: tenant.publisherId,
    })
    .execute();
  // The document is pointed at by its version too; the draft alone is shown by deleting a document with no version.
  const bare = await db
    .insertInto('cla_documents')
    .values({
      installation_id: tenant.installationId,
      repository_id: null,
      name: 'Bare',
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('cla_drafts')
    .values({
      document_id: bare.id,
      installation_id: tenant.installationId,
      content_md: 'Bare draft\n',
      updated_by: tenant.publisherId,
    })
    .execute();
  const removal = await sql`delete from cla_documents where id = ${bare.id}`.execute(db).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(RESTRICTED.safeParse(removal).success).toBe(true);
  const person = await sql`delete from users where id = ${tenant.publisherId}`.execute(db).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(RESTRICTED.safeParse(person).success).toBe(true);
  const kept = await db.selectFrom('cla_drafts').select('document_id').execute();
  expect(kept).toHaveLength(2);
});

test('the runtime role reads, creates, saves and discards drafts, and may not truncate the table', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  const grants = await sql<{ privilege_type: string }>`
    select privilege_type from information_schema.role_table_grants
    where grantee = 'cla_app' and table_name = 'cla_drafts' order by privilege_type`.execute(db);
  expect(grants.rows.map((row) => row.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  await asRuntimeRole(db, async (trx) => {
    await trx
      .insertInto('cla_drafts')
      .values({
        document_id: tenant.documentId,
        installation_id: tenant.installationId,
        content_md: 'Draft\n',
        updated_by: tenant.publisherId,
      })
      .execute();
    await trx
      .updateTable('cla_drafts')
      .set({ content_md: 'Saved\n', revision: 2 })
      .where('document_id', '=', tenant.documentId)
      .execute();
    expect(await trx.selectFrom('cla_drafts').select(['content_md', 'revision']).execute()).toEqual([
      { content_md: 'Saved\n', revision: 2 },
    ]);
    await trx.deleteFrom('cla_drafts').where('document_id', '=', tenant.documentId).execute();
    expect(await trx.selectFrom('cla_drafts').select('revision').execute()).toEqual([]);
  });
  await expect(asRuntimeRole(db, (trx) => sql`truncate cla_drafts`.execute(trx))).rejects.toMatchObject(DENIED);
});

test('the immutability of the versions and the documents is the one migration 001 made: a draft changes neither', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await db
    .insertInto('cla_drafts')
    .values({
      document_id: tenant.documentId,
      installation_id: tenant.installationId,
      content_md: 'Draft\n',
      updated_by: tenant.publisherId,
    })
    .execute();
  const version = sql`update cla_versions set rationale = 'changed' where id = ${tenant.versionId}`.execute(db);
  await expect(version).rejects.toMatchObject({ code: '23001' });
  const kind = sql`update cla_documents set kind = 'corporate' where id = ${tenant.documentId}`.execute(db);
  await expect(kind).rejects.toMatchObject({ code: '23001' });
  const document = await db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', tenant.documentId)
    .executeTakeFirstOrThrow();
  expect(document.active_version_id).toBe(tenant.versionId);
});

test('the file creates the one table and touches no trigger, function, constraint or grant of any other', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a migration file of this repository's own folder
  const text = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, '011_cla_drafts.sql'), 'utf8');
  const statements = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  expect(statements.match(/create table\s+(\w+)/gi)).toEqual(['create table cla_drafts']);
  expect(statements).not.toMatch(/\b(?:drop|alter)\b/i);
  expect(statements).not.toMatch(/\b(?:trigger|function)\b/i);
  expect([...statements.matchAll(/ on %1\$s\.(\w+) to /g)].map((match) => match[1])).toEqual(['cla_drafts']);
});

test('the migration is recorded under its own number, on top of the earlier ones', async () => {
  const { db } = await migratedTestDatabase();
  const { rows } = await sql<{ name: string }>`select name from schema_migrations where name like '011%'`.execute(db);
  expect(rows).toEqual([{ name: '011_cla_drafts.sql' }]);
});
