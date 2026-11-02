// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { PGlite } from '@electric-sql/pglite';
import { type Kysely, sql } from 'kysely';
import { expect, onTestFinished, test } from 'vitest';
import { PgliteDriver } from './pglite/driver.ts';
import { toExecResult, toQueryResult } from './pglite/results.ts';
import { openPgliteDatabase } from './pglite.ts';
import type { Database } from './schema.ts';

async function open(): Promise<Kysely<Database>> {
  const db = await openPgliteDatabase();
  onTestFinished(async () => {
    await db.destroy();
  });
  await sql`create table scratch (id integer primary key, note text)`.execute(db);
  return db;
}

const count = async (db: Kysely<Database>): Promise<number> =>
  (await sql<{ n: number }>`select count(*)::int as n from scratch`.execute(db)).rows[0]?.n ?? -1;

test('it is Postgres 18', async () => {
  const db = await open();
  const { rows } = await sql<{ v: string }>`select current_setting('server_version_num') as v`.execute(db);
  expect(rows[0]?.v.slice(0, 2)).toBe('18');
});

test('parameterised statements bind their parameters and report affected rows', async () => {
  const db = await open();
  const insert = await sql`insert into scratch (id, note) values (${1}, ${'a'}), (${2}, ${'b'})`.execute(db);
  expect(insert.numAffectedRows).toBe(2n);
  const { rows } = await sql<{ note: string }>`select note from scratch where id = ${2}`.execute(db);
  expect(rows).toEqual([{ note: 'b' }]);
});

test('a script of several statements without parameters runs in one call', async () => {
  const db = await open();
  await sql
    .raw("insert into scratch values (1, 'x'); insert into scratch values (2, 'y'); update scratch set note = 'z'")
    .execute(db);
  expect(await count(db)).toBe(2);
  const { rows } = await sql<{ note: string }>`select distinct note from scratch`.execute(db);
  expect(rows).toEqual([{ note: 'z' }]);
});

test('result helpers default a missing affected row count to 0 and an empty script to no rows', () => {
  expect(toQueryResult([{ a: 1 }], undefined)).toEqual({ rows: [{ a: 1 }], numAffectedRows: 0n });
  expect(toQueryResult([], 3)).toEqual({ rows: [], numAffectedRows: 3n });
  expect(toExecResult([])).toEqual({ rows: [], numAffectedRows: 0n });
  expect(
    toExecResult([
      { rows: [{ n: 1 }], affectedRows: 1 },
      { rows: [{ n: 2 }, { n: 3 }], affectedRows: 2 },
    ]),
  ).toEqual({
    rows: [{ n: 2 }, { n: 3 }],
    numAffectedRows: 2n,
  });
});

test('an empty script returns no rows', async () => {
  const db = await open();
  const result = await sql.raw('-- nothing but a comment').execute(db);
  expect(result.rows).toEqual([]);
  expect(result.numAffectedRows).toBe(0n);
});

test('bigint comes back as a number, like with node-postgres', async () => {
  const db = await open();
  const { rows } = await sql<{ big: number }>`select 9007199254740991::bigint as big`.execute(db);
  expect(rows).toEqual([{ big: Number.MAX_SAFE_INTEGER }]);
  await expect(sql`select 9007199254740993::bigint`.execute(db)).rejects.toThrow(RangeError);
});

test('a transaction commits all of its statements or none of them', async () => {
  const db = await open();
  await db.transaction().execute(async (trx) => {
    await sql`insert into scratch values (1, 'kept')`.execute(trx);
  });
  await expect(
    db.transaction().execute(async (trx) => {
      await sql`insert into scratch values (2, 'lost')`.execute(trx);
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  expect(await count(db)).toBe(1);
});

test('isolation level and access mode are applied to the transaction', async () => {
  const db = await open();
  const level = await db
    .transaction()
    .setIsolationLevel('serializable')
    .execute((trx) => sql<{ transaction_isolation: string }>`show transaction_isolation`.execute(trx));
  expect(level.rows).toEqual([{ transaction_isolation: 'serializable' }]);
  const readOnly = db
    .transaction()
    .setAccessMode('read only')
    .execute((trx) => sql`insert into scratch values (1, 'x')`.execute(trx));
  await expect(readOnly).rejects.toMatchObject({ code: '25006' });
});

test('isolation level and access mode can be set on the same transaction', async () => {
  const db = await open();
  const state = await db
    .transaction()
    .setIsolationLevel('repeatable read')
    .setAccessMode('read only')
    .execute((trx) =>
      sql<{
        level: string;
        readOnly: string;
      }>`select current_setting('transaction_isolation') as level, current_setting('transaction_read_only') as "readOnly"`.execute(
        trx,
      ),
    );
  expect(state.rows).toEqual([{ level: 'repeatable read', readOnly: 'on' }]);
});

test('the single connection is queued: nobody sees the inside of another transaction', async () => {
  const db = await open();
  const writer = db.transaction().execute(async (trx) => {
    await sql`insert into scratch values (1, 'uncommitted')`.execute(trx);
    await new Promise((resolve) => setTimeout(resolve, 50));
    throw new Error('rollback');
  });
  const reader = new Promise<number>((resolve) => setTimeout(() => void count(db).then(resolve), 10));
  await expect(writer).rejects.toThrow('rollback');
  expect(await reader).toBe(0);
});

test('streaming is not supported and says so', async () => {
  const db = await open();
  const stream = sql`select 1`.compile(db);
  await expect(async () => {
    for await (const chunk of db.selectFrom('users').selectAll().stream()) {
      expect(chunk).toBeUndefined();
    }
  }).rejects.toThrow('do not support streaming');
  expect(stream.sql).toBe('select 1');
});

test('Kysely can introspect the schema through the dialect', async () => {
  const db = await open();
  const tables = await db.introspection.getTables();
  expect(tables.map((table) => table.name)).toEqual(['scratch']);
  expect(tables[0]?.columns.map((column) => column.name)).toEqual(['id', 'note']);
});

test('destroying the driver closes the PGlite instance, which frees its memory', async () => {
  const client = new PGlite();
  const driver = new PgliteDriver(client);
  await driver.init();
  expect(client.closed).toBe(false);
  await driver.destroy();
  expect(client.closed).toBe(true);
});

test('destroy closes the database', async () => {
  const db = await openPgliteDatabase();
  await db.destroy();
  await expect(sql`select 1`.execute(db)).rejects.toThrow();
});
