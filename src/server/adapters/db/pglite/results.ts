// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Results } from '@electric-sql/pglite';
import type { QueryResult } from 'kysely';

/**
 * PGlite types `affectedRows` as optional (in practice it is always set), hence the default.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function toQueryResult<R>(rows: R[], affectedRows: number | undefined): QueryResult<R> {
  return { rows, numAffectedRows: BigInt(affectedRows ?? 0) };
}

/**
 * The result of a script is the result of its last statement. An empty list (in practice never returned) is no rows.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function toExecResult<R>(results: readonly Pick<Results, 'rows' | 'affectedRows'>[]): QueryResult<R> {
  const last = results.at(-1);
  // type-coverage:ignore-next-line -- exec() rows are untyped; Kysely's R is the caller's contract, as in every dialect
  return toQueryResult((last?.rows ?? []) as R[], last?.affectedRows);
}
