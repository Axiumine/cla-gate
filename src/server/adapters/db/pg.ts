// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { INT8_OID, parseInt8 } from './int8.ts';
import type { Database } from './schema.ts';

const POOL_SIZE = 10;
const CONNECT_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 30_000;

type Parser = (value: string) => unknown;
/** pg-types types `getTypeParser` as returning `any`; this keeps the fallback typed. */
const defaultParser: (oid: number, format?: 'text' | 'binary') => Parser = pg.types.getTypeParser;

/**
 * bigint (oid 20) becomes a number, everything else keeps the node-postgres default.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function typeParser(oid: number, format?: 'text' | 'binary'): Parser {
  return oid === INT8_OID ? parseInt8 : defaultParser(oid, format);
}

export interface PgOptions {
  /** Contains the password: pass it from a `Secret`, never log it. */
  readonly connectionString: string;
  /** Called for errors on idle pooled clients. Without a listener Node would crash the process on them. */
  readonly onError: (error: Error) => void;
}

/**
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 * The pool is lazy: nothing connects until the first query.
 */
export function createPgPool(options: PgOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: POOL_SIZE,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    types: { getTypeParser: typeParser },
  });
  pool.on('error', options.onError);
  return pool;
}

/** The production database: node-postgres behind Kysely. `destroy()` ends the pool. */
export function createPgDatabase(options: PgOptions): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: createPgPool(options) }) });
}
