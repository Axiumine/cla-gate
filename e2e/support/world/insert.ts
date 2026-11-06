// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';

// E18-S12: how the specs put rows into the database. The server is never asked to create a tenant: the specs write the rows
// themselves, with the numbers they choose, so that a screen shows the same thing on every run.

/** What a column of a seeded row may hold: text, a number, a flag, a time or nothing. */
export type Cell = string | number | boolean | Date | null;

export type Row = Readonly<Record<string, Cell>>;

/**
 * Inserts one row with the identity the row names: `overriding system value` lets a table whose key is `generated always`
 * take the number given, so a seeded row has the same id on every run and a screen that shows the id shows the same one.
 * The table is a key of the database type, so it cannot be a text from outside, and the columns are quoted as identifiers.
 */
export async function insertRow(db: Kysely<Database>, table: keyof Database, row: Row): Promise<void> {
  const cells = Object.entries(row);
  const columns = sql.join(cells.map(([column]) => sql.ref(column)));
  const values = sql.join(cells.map(([, cell]) => cell));
  await sql`insert into ${sql.table(table)} (${columns}) overriding system value values (${values})`.execute(db);
}

/** The hash a session row keeps for a cookie value: SHA-256 as 64 lower-case hex characters. */
export function sessionHashOf(cookieValue: string): string {
  return createHash('sha256').update(cookieValue, 'utf8').digest('hex');
}

/** The SHA-256 of a text as 64 lower-case hex characters: what `cla_versions.content_sha256` must equal. */
export function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A time of the seeded history, from an ISO text; the seeds never read the clock for what a screen shows. */
export function at(isoUtc: string): Date {
  return new Date(isoUtc);
}

/** The triggers that compare a new row's time with the clock of the database, which a fixed history of the past cannot satisfy. */
const CLOCK_TRIGGERS = [
  ['cla_versions', 'cla_versions_current_timestamp'],
  ['signatures', 'signatures_current_timestamp'],
] as const;

/**
 * Runs `work` with the "must be within five minutes of now" triggers of versions and signatures switched off, in one
 * transaction, so that a fixed history can be written. The triggers are switched on again before the transaction ends, and
 * a failed `work` rolls the switch back with everything else. Needs the owner of the tables, as the migrations are.
 */
export async function withFixedHistory(
  db: Kysely<Database>,
  work: (trx: Kysely<Database>) => Promise<void>,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    for (const [table, trigger] of CLOCK_TRIGGERS) {
      await sql`alter table ${sql.table(table)} disable trigger ${sql.ref(trigger)}`.execute(trx);
    }
    await work(trx);
    for (const [table, trigger] of CLOCK_TRIGGERS) {
      await sql`alter table ${sql.table(table)} enable trigger ${sql.ref(trigger)}`.execute(trx);
    }
  });
}
