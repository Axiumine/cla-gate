// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../db/schema.ts';
import { PGBOSS_SCHEMA } from './queues.ts';

/** The unprivileged role the application connects as (`scripts/provision-database.sql`). It owns nothing. */
const RUNTIME_ROLE = 'cla_app';

/** The name the grants are serialised under (E19-S12): hashed to the key of a transaction-level advisory lock. */
const GRANTS_LOCK_NAME = 'migrate:runtime-grants';

/**
 * Grants the runtime role what pg-boss needs at run time and nothing it could change the schema with (E07-S01): use of
 * the schema, DML on its tables, use of its sequences, execution of its functions. There is no `CREATE` on the schema, no
 * ownership, no `TRUNCATE` and no `REFERENCES` or `TRIGGER`, so `cla_app` cannot alter or drop a pgboss table. Default
 * privileges give the same to the tables, sequences and functions the owner creates in the schema later (a pg-boss
 * migration, a queue with a table of its own), and every run of the migrate step repeats the grants on what exists, so a
 * database that predates them is brought in line. Like migration 001, it does nothing when the role does not exist (a
 * plain install or PGlite).
 *
 * Two migrate steps that run at once (two `docker compose run migrate`, or a rolling deploy) take turns here (E19-S12): a
 * transaction-level advisory lock is the first statement. Without it the second `grant usage on schema` fails with
 * `tuple concurrently updated`, because PostgreSQL does not lock the catalogue row of an object that two sessions grant on
 * at the same time. The lock ends with the transaction, so there is nothing to release.
 * @param db A connection of the migration owner: only the owner can grant on the tables it owns.
 */
export async function grantRuntimeAccess(db: Kysely<Database>): Promise<'granted' | 'skipped'> {
  const { rows } = await sql`select 1 from pg_roles where rolname = ${RUNTIME_ROLE}`.execute(db);
  if (rows.length === 0) {
    return 'skipped';
  }
  const schema = sql.id(PGBOSS_SCHEMA);
  const role = sql.id(RUNTIME_ROLE);
  const statements = [
    sql`grant usage on schema ${schema} to ${role}`,
    sql`grant select, insert, update, delete on all tables in schema ${schema} to ${role}`,
    sql`grant usage, select, update on all sequences in schema ${schema} to ${role}`,
    sql`grant execute on all functions in schema ${schema} to ${role}`,
    sql`alter default privileges in schema ${schema} grant select, insert, update, delete on tables to ${role}`,
    sql`alter default privileges in schema ${schema} grant usage, select, update on sequences to ${role}`,
    sql`alter default privileges in schema ${schema} grant execute on functions to ${role}`,
  ];
  await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${GRANTS_LOCK_NAME}, 0))`.execute(trx);
    for (const statement of statements) {
      await statement.execute(trx);
    }
  });
  return 'granted';
}
