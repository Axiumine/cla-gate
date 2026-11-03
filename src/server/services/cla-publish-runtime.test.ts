// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from '../adapters/db/schema.ts';
import { asRuntimeRole } from '../adapters/db/test-support.ts';
import { publishVersion } from './cla-publish.ts';
import { draftWith, publication, runtimePublishWorld, versionsOf } from './publish-fixture/test-support.ts';

// The runtime role and the versions (E12-S04). The application connects as `cla_app`, which owns nothing and holds `select` and
// `insert` on `cla_versions` and no more: the table is append-only for the code that publishes, so a bug cannot rewrite or
// remove a version, whatever the statement. PGlite enforces the privileges of a role switched to with `SET ROLE` like Postgres
// does, so these tests run on both. The owner role is refused too, by the triggers of migration 001.

const DENIED = { code: '42501' };
const RESTRICT = { code: '23001' };

/** Runs `work` on one connection that has switched to `cla_app` for the whole of it, transactions included. */
function onRuntimeConnection<T>(db: Kysely<Database>, work: (connection: Kysely<Database>) => Promise<T>): Promise<T> {
  return db.connection().execute(async (connection) => {
    await sql`set role cla_app`.execute(connection);
    try {
      return await work(connection);
    } finally {
      await sql`reset role`.execute(connection);
    }
  });
}

test('cla_app holds select and insert on cla_versions and no other privilege, and no update on any column', async () => {
  const { db } = await runtimePublishWorld();
  const held = await asRuntimeRole(db, async (trx) => {
    const { rows } = await sql<{ privilege: string }>`
      select p as privilege from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p
      where has_table_privilege('cla_app', 'cla_versions', p)
      order by p`.execute(trx);
    const column = await sql<{ any: boolean }>`
      select has_any_column_privilege('cla_app', 'cla_versions', 'UPDATE') as "any"`.execute(trx);
    return { table: rows.map((row) => row.privilege), updatableColumn: column.rows[0]?.any };
  });
  expect(held).toEqual({ table: ['INSERT', 'SELECT'], updatableColumn: false });
});

test('as cla_app a version is read and inserted, and an update or a delete of it is refused', async () => {
  const { db, wide } = await runtimePublishWorld();
  const [version] = await versionsOf(db, wide);
  const inserted = await asRuntimeRole(db, async (trx) => {
    const read = await trx
      .selectFrom('cla_versions')
      .select('id')
      .where('id', '=', version?.id ?? 0)
      .execute();
    const created = await trx
      .insertInto('cla_versions')
      .columns(['document_id', 'major', 'minor', 'content_md', 'content_sha256', 'published_by', 'rationale'])
      .expression((eb) =>
        eb
          .selectFrom('cla_versions')
          .select([
            'document_id',
            eb.val(2).as('major'),
            eb.val(0).as('minor'),
            'content_md',
            'content_sha256',
            'published_by',
            'rationale',
          ])
          .where('id', '=', version?.id ?? 0),
      )
      .returning('id')
      .execute();
    return { read, created };
  });
  expect(inserted.read).toHaveLength(1);
  expect(inserted.created).toHaveLength(1);
  const before = await versionsOf(db, wide);
  expect(before.map((row) => `${row.major}.${row.minor}`)).toEqual(['1.0', '2.0']);

  await expect(
    asRuntimeRole(db, (trx) => trx.updateTable('cla_versions').set({ rationale: 'rewritten' }).execute()),
  ).rejects.toMatchObject(DENIED);
  await expect(asRuntimeRole(db, (trx) => trx.deleteFrom('cla_versions').execute())).rejects.toMatchObject(DENIED);
  expect(await versionsOf(db, wide)).toEqual(before);
});

test('the owner role cannot rewrite or remove a version either: the triggers of migration 001 refuse', async () => {
  const { db, wide } = await runtimePublishWorld();
  const before = await versionsOf(db, wide);
  await expect(db.updateTable('cla_versions').set({ rationale: 'rewritten' }).execute()).rejects.toMatchObject(
    RESTRICT,
  );
  await expect(db.deleteFrom('cla_versions').execute()).rejects.toMatchObject(RESTRICT);
  expect(await versionsOf(db, wide)).toEqual(before);
});

test('a major version is published, with its jobs, by a connection that is cla_app from the first statement to the commit', async () => {
  const world = await runtimePublishWorld();
  const { db, wide, scope } = world;
  await sql`grant select, insert on fake_jobs to cla_app`.execute(db);
  await sql`grant usage on sequence fake_jobs_id_seq to cla_app`.execute(db);
  const revision = await draftWith(world, wide, 'The next text\n');
  const plan = await publication(world, wide, {
    source: { type: 'draft', revision },
    acknowledgeResigning: true,
  });
  const published = await onRuntimeConnection(db, (connection) =>
    publishVersion(connection, scope, world.enqueuer, plan),
  );
  expect(published).toMatchObject({ requiresResigning: true, affectedSignatures: 1 });
  expect((await versionsOf(db, wide)).map((row) => `${row.major}.${row.minor}`)).toEqual(['1.0', '2.0']);
  const pointer = await db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', wide)
    .executeTakeFirstOrThrow();
  expect(pointer.active_version_id).toBe(published.version.id);
  expect(await db.selectFrom('cla_drafts').select('document_id').where('document_id', '=', wide).execute()).toEqual([]);
  expect(
    await db.selectFrom('audit_log').select('id').where('action', '=', 'cla_version.published').execute(),
  ).toHaveLength(1);
});
