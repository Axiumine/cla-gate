// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { setTimeout as sleepFor } from 'node:timers/promises';
import { type Kysely, sql } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from './adapters/db/schema.ts';

// The start-up database check (E19-S02): before the server listens, `select 1` runs as the runtime role. A database that is
// still starting (a compose stack, a restart of the server that hosts it) gets a few more tries; one that stays away ends the
// start with a line that says which setting to look at, and never the connection string or the driver's message.

/** How often the check tries before it gives up. */
const ATTEMPTS = 5;
/** The pause between two tries, in milliseconds. */
const BACKOFF_MS = 2000;

export interface DatabaseCheckOptions {
  readonly db: Kysely<Database>;
  readonly logger: Logger;
  /** Where the final line goes: stderr in production, a capture in the tests. */
  readonly err: (line: string) => void;
  /** Waits between two tries. Defaults to a timer; tests pass a recording fake. */
  readonly sleep?: ((milliseconds: number) => Promise<unknown>) | undefined;
}

/** The code of a driver or system error (`ECONNREFUSED`, `28P01`), or `UNKNOWN`. Its message may quote the connection string. */
function failureCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && /^\w{1,32}$/.test(code) ? code : 'UNKNOWN';
}

/**
 * Runs `select 1` up to five times, two seconds apart. Each failed try is logged as a warning with its attempt number and
 * the error code only. After the last one the answer is false and `err` has the line
 * `database: cannot connect (<code>); check DATABASE_URL and that the database is up`.
 * @returns true as soon as the database answers.
 */
export async function checkDatabase(options: DatabaseCheckOptions): Promise<boolean> {
  const { db, logger, err } = options;
  const sleep = options.sleep ?? sleepFor;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await sql`select 1`.execute(db);
      return true;
    } catch (error) {
      const code = failureCode(error);
      if (attempt === ATTEMPTS) {
        err(`database: cannot connect (${code}); check DATABASE_URL and that the database is up`);
        return false;
      }
      logger.warn({ attempt, code }, 'database.connect_retry');
      await sleep(BACKOFF_MS);
    }
  }
}
