// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { byName, MigrationError, type MigrationFile } from './migration-files.ts';

/**
 * Arbitrary but fixed: every runner of this application takes the same session-level advisory lock.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const MIGRATION_LOCK_KEY = 7_231_955_001;

interface AppliedRow {
  readonly name: string;
  readonly checksum: string;
}

/**
 * The applied migrations must be exactly a prefix of the files on disk, with the same checksums. Anything else means
 * history was rewritten (an edited, removed or out of order migration) and the database may not match the code.
 */
function pendingMigrations(applied: readonly AppliedRow[], files: readonly MigrationFile[]): MigrationFile[] {
  const byFile = new Map(files.map((file) => [file.name, file]));
  for (const row of applied) {
    const file = byFile.get(row.name);
    if (file === undefined) {
      throw new MigrationError(`applied migration ${row.name} is missing from the migrations directory`);
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationError(
        `applied migration ${row.name} was edited after it was applied (checksum mismatch); ` +
          'migrations are forward-only: restore the file and add a new migration instead',
      );
    }
  }
  const appliedNames = new Set(applied.map((row) => row.name));
  const pending = files.filter((file) => !appliedNames.has(file.name));
  const newest = applied.toSorted(byName).at(-1)?.name ?? '';
  const stale = pending.find((file) => file.name < newest);
  if (stale !== undefined) {
    throw new MigrationError(
      `pending migration ${stale.name} is older than the applied migration ${newest}; ` +
        'migrations must be added in order',
    );
  }
  return pending;
}

async function applyPending<DB>(db: Kysely<DB>, files: readonly MigrationFile[]): Promise<string[]> {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz not null default now()
    )`.execute(db);
  const { rows } = await sql<AppliedRow>`select name, checksum from schema_migrations`.execute(db);
  const applied: string[] = [];
  for (const file of pendingMigrations(rows, files)) {
    // One transaction per migration: its SQL and its schema_migrations row commit together or not at all.
    await db.transaction().execute(async (trx) => {
      await sql.raw(file.sql).execute(trx);
      await sql`insert into schema_migrations (name, checksum) values (${file.name}, ${file.checksum})`.execute(trx);
    });
    applied.push(file.name);
  }
  return applied;
}

/**
 * Applies every migration in `files` that the database has not seen, in name order, and returns their names.
 *
 * Forward-only: it refuses (MigrationError, nothing applied) when an applied migration was edited or removed, or when
 * a new one sorts before an applied one. A session-level advisory lock on a dedicated connection serialises
 * concurrent runners; the waiting runner then finds everything applied and does nothing.
 */
export async function migrate<DB>(db: Kysely<DB>, files: readonly MigrationFile[]): Promise<string[]> {
  const ordered = files.toSorted(byName);
  return db.connection().execute(async (connection) => {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`.execute(connection);
    try {
      return await applyPending(connection, ordered);
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.execute(connection);
    }
  });
}
