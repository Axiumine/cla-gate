// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
/**
 * Applies `apply` to `query` with `value` when there is one, and gives `query` back as it is when there is none: an optional filter of
 * a statement (the position a page starts at, one id to look for) without a branch in the file that builds the statement (E21-S02).
 */
export function whenPresent<Query, Value>(
  query: Query,
  value: Value | null,
  apply: (query: Query, value: Value) => Query,
): Query {
  return value === null ? query : apply(query, value);
}

/** `convert(row)` for the row a statement found, or `null` when it found none: the answer of a lookup by key, in one expression (E21-S02). */
export function mapFound<Row, Result>(row: Row | undefined, convert: (row: Row) => Result): Result | null {
  return row === undefined ? null : convert(row);
}
