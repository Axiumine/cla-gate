// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** Postgres type oid of int8 (bigint), the type of every GitHub id and every identity key. */
export const INT8_OID = 20;

const INTEGER = /^-?\d{1,19}$/;

/**
 * Parses a bigint column into a JS number. GitHub ids are far below 2^53, so a number is exact; a value that is not
 * would silently round, so it throws instead. Both drivers use this, which keeps pg and PGlite results identical.
 */
export function parseInt8(text: string): number {
  const value = Number(text);
  if (!INTEGER.test(text) || !Number.isSafeInteger(value)) {
    throw new RangeError('bigint value is outside the safe integer range');
  }
  return value;
}
