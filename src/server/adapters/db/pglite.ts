// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { PGlite } from '@electric-sql/pglite';
import {
  type Dialect,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely';
import { INT8_OID, parseInt8 } from './int8.ts';
import { PgliteDriver } from './pglite/driver.ts';
import type { Database } from './schema.ts';

// PGlite (Postgres 18 compiled to WASM) is the database of the unit tests and is never used in production, so this
// file and the pglite/ folder are outside the build (tsconfig.server.json) and Knip's production project. There is no maintained Kysely
// dialect that fits: kysely-pglite-dialect sends every statement through the extended protocol, which rejects the
// multi-statement scripts migrations are made of. This one sends parameterless statements through `exec` (the
// simple protocol, like node-postgres does) and queues connections, because PGlite has exactly one.

class PgliteDialect implements Dialect {
  readonly #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  createAdapter(): PostgresAdapter {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new PgliteDriver(this.#client);
  }

  createIntrospector(db: Kysely<unknown>): PostgresIntrospector {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler(): PostgresQueryCompiler {
    return new PostgresQueryCompiler();
  }
}

/** A fresh in-memory Postgres 18, ready for queries. `destroy()` on the returned Kysely closes it. */
export async function openPgliteDatabase(): Promise<Kysely<Database>> {
  const client = new PGlite({ parsers: { [INT8_OID]: parseInt8 } });
  const db = new Kysely<Database>({ dialect: new PgliteDialect(client) });
  // Kysely starts its driver lazily and destroy() is a no-op before that, which would leak the WASM instance.
  // Stryker disable next-line StringLiteral: any statement starts the driver, the text of this one is not used for anything
  await sql`select 1`.execute(db);
  return db;
}
