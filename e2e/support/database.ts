// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import type { Kysely } from 'kysely';
import { variable } from '../../scripts/ci/lib/env.ts';
import { createPgDatabase } from '../../src/server/adapters/db/pg.ts';
import type { Database } from '../../src/server/adapters/db/schema.ts';

// E18-S12: the specs reach the database of the application under test the way the application does (node-postgres behind
// Kysely, bigint columns read as numbers), with the DATABASE_URL of the run. They write the rows of a tenant and a session
// directly, so no call to GitHub and no OAuth round trip is needed to be signed in.

/**
 * Runs `work` on a connection to the database of the run and closes it afterwards.
 * @throws Error when DATABASE_URL is not set: the specs need the database the server under test uses.
 */
export async function withDatabase<T>(work: (db: Kysely<Database>) => Promise<T>): Promise<T> {
  const url = variable(process.env, 'DATABASE_URL');
  if (url === '') {
    throw new Error(
      'DATABASE_URL is not set: the specs write their tenants into the database of the server under test',
    );
  }
  const db = createPgDatabase({
    connectionString: url,
    onError: (error) => {
      console.error(`database connection of the specs: ${error.message}`);
    },
  });
  try {
    return await work(db);
  } finally {
    await db.destroy();
  }
}
