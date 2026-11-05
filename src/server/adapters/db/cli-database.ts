// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import type { Kysely } from 'kysely';
import { ConfigError } from '../../config/config-error.ts';
import { type AppConfig, loadConfig } from '../../config/env.ts';
import { createPgDatabase } from './pg.ts';
import type { Database } from './schema.ts';

// What the operator commands share (E22-S04, E22-S05): the options every command takes, the two output sinks, the connection as
// the runtime role of `DATABASE_URL`, and the way a failure is printed. A command prints numbers and names of tables, never a
// row, and a failure is reported by the name and the SQLSTATE of the error, never by its message: the message of a database
// error can quote a row.

export interface CliOptions {
  /** The arguments after the script name. */
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
  /** Defaults to node-postgres. Tests pass PGlite. */
  readonly connect?: (connectionString: string, onError: (error: Error) => void) => Kysely<Database>;
}

/** The two sinks of a command: the ones it was given, else standard output and standard error, one line at a time. */
export function sinksOf(options: Pick<CliOptions, 'out' | 'err'>): {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
} {
  return {
    out: options.out ?? ((line: string) => process.stdout.write(`${line}\n`)),
    err: options.err ?? ((line: string) => process.stderr.write(`${line}\n`)),
  };
}

/** Writes each of the lines to the sink, in order. */
export function printLines(sink: (line: string) => void, lines: readonly string[]): void {
  for (const line of lines) {
    sink(line);
  }
}

/** The SQLSTATE or system code of a failure, when it has one that is plain: the message of a database error can quote a row. */
function codeOf(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && /^\w{1,32}$/.test(code) ? ` (${code})` : '';
}

/** What a failed run of the command `label` prints: one line per invalid variable, or the name and the code of the error, never its message. */
export function failureLines(label: string, error: unknown): string[] {
  if (error instanceof ConfigError) {
    return error.lines.map((line) => `${label} failed: ${line}`);
  }
  return [`${label} failed: ${error instanceof Error ? error.name : 'unknown error'}${codeOf(error)}`];
}

/**
 * Loads the configuration of the environment, opens the connection of `DATABASE_URL` (an error of the pool outside a query is
 * printed as `<label>: database error` with its code only), runs `use` on it and closes it, whatever `use` did.
 * @throws ConfigError when the environment is invalid, and whatever `use` throws.
 */
export async function withDatabase<T>(
  label: string,
  options: Pick<CliOptions, 'env' | 'connect'> & { readonly err: (line: string) => void },
  use: (db: Kysely<Database>, config: AppConfig) => Promise<T>,
): Promise<T> {
  const config = loadConfig(options.env);
  const connect = options.connect ?? ((connectionString, onError) => createPgDatabase({ connectionString, onError }));
  const db = connect(config.databaseUrl.reveal(), (error) => {
    options.err(`${label}: database error${codeOf(error)}`);
  });
  try {
    return await use(db, config);
  } finally {
    await db.destroy();
  }
}
