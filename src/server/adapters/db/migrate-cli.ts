// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import type { Kysely } from 'kysely';
import { ConfigError } from '../../config/config-error.ts';
import { loadMigrateConfig } from '../../config/migrate-config.ts';
import { migrateJobQueues, type QueueMigration, type QueueMigrationOptions } from '../jobs/migrate-queues.ts';
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
  /**
   * The step after the SQL files (E07-S01): pg-boss's own schema, the queues and the runtime role's grants. Defaults to
   * {@link migrateJobQueues}. Tests pass a fake, because pg-boss needs a real PostgreSQL.
   */
  readonly queueStep?: (options: QueueMigrationOptions) => Promise<QueueMigration>;
}

function describe(error: unknown): string {
  if (error instanceof MigrationError) {
    return error.message;
  }
  if (error instanceof Error) {
    // Never the stack, and pg connection errors can have an empty message (AggregateError), hence the code.
    const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
    return `${error.name}: ${error.message || code || 'no details'}`;
  }
  return 'unknown error';
}

/** What a failed run prints: one line per problem, each starting `migration failed: `; an invalid environment has one per variable (E19-S02). */
function failureLines(error: unknown): string[] {
  const lines = error instanceof ConfigError ? error.lines : [describe(error)];
  return lines.map((line) => `migration failed: ${line}`);
}

function queueLines(result: QueueMigration): string[] {
  const unchanged = result.created.length === 0 && result.updated.length === 0;
  return [
    ...(unchanged ? ['job queues: up to date'] : []),
    ...(result.created.length === 0 ? [] : [`job queues created: ${result.created.join(', ')}`]),
    ...(result.updated.length === 0 ? [] : [`job queues updated: ${result.updated.join(', ')}`]),
    ...(result.grants === 'skipped' ? ['role cla_app does not exist: pgboss runtime grants skipped'] : []),
  ];
}

/**
 * `yarn db:migrate`: applies pending migrations as the owner role, then the job queue step (pg-boss's schema, the
 * queues, the runtime grants), and returns the process exit code (0 or 1). Prints the names of what it applied or
 * created, or that nothing was pending; never a connection string.
 */
export async function runMigrateCli(options: MigrateCliOptions): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const connect = options.connect ?? ((connectionString, onError) => createPgDatabase({ connectionString, onError }));
  try {
    const config = loadMigrateConfig(options.env);
    const files = await loadMigrationFiles(options.directory);
    const onError = (error: Error): void => {
      err(`database error: ${describe(error)}`);
    };
    const db = connect(config.databaseUrl.reveal(), onError);
    try {
      const applied = await migrate(db, files);
      out(applied.length === 0 ? 'migrations: up to date' : `migrations applied: ${applied.join(', ')}`);
      const queues = await (options.queueStep ?? migrateJobQueues)({
        connectionString: config.databaseUrl.reveal(),
        db,
        onError,
      });
      for (const line of queueLines(queues)) {
        out(line);
      }
    } finally {
      await db.destroy();
    }
    return 0;
  } catch (error) {
    for (const line of failureLines(error)) {
      err(line);
    }
    return 1;
  }
}
