// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import type { Kysely } from 'kysely';
import { ConfigError } from '../../config/env.ts';
import { loadMigrateConfig } from '../../config/migrate-config.ts';
import { loadMigrationFiles, MigrationError } from './migration-files.ts';
import { migrate } from './migrator.ts';
import { createPgDatabase } from './pg.ts';
import type { Database } from './schema.ts';

export interface MigrateCliOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Directory holding `NNN_name.sql`. */
  readonly directory: string;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
  /** Defaults to node-postgres. Tests pass PGlite. */
  readonly connect?: (connectionString: string, onError: (error: Error) => void) => Kysely<Database>;
}

function describe(error: unknown): string {
  if (error instanceof ConfigError || error instanceof MigrationError) {
    return error.message;
  }
  if (error instanceof Error) {
    // Never the stack, and pg connection errors can have an empty message (AggregateError), hence the code.
    const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
    return `${error.name}: ${error.message || code || 'no details'}`;
  }
  return 'unknown error';
}

/**
 * `yarn db:migrate`: applies pending migrations as the owner role and returns the process exit code (0 or 1).
 * Prints the names of what it applied, or that nothing was pending; never a connection string.
 */
export async function runMigrateCli(options: MigrateCliOptions): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const connect = options.connect ?? ((connectionString, onError) => createPgDatabase({ connectionString, onError }));
  try {
    const config = loadMigrateConfig(options.env);
    const files = await loadMigrationFiles(options.directory);
    const db = connect(config.databaseUrl.reveal(), (error) => {
      err(`database error: ${describe(error)}`);
    });
    try {
      const applied = await migrate(db, files);
      out(applied.length === 0 ? 'migrations: up to date' : `migrations applied: ${applied.join(', ')}`);
    } finally {
      await db.destroy();
    }
    return 0;
  } catch (error) {
    err(`migration failed: ${describe(error)}`);
    return 1;
  }
}
