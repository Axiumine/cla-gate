// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// What a driver reports when the database refuses a statement for a constraint. node-postgres and PGlite both put the
// SQLSTATE in `code` and the name of the constraint in `constraint`.

/** The SQLSTATE of a unique violation. */
const UNIQUE_VIOLATION = '23505';

const violation = z.object({ code: z.string(), constraint: z.string().optional() });

/**
 * True when `error` is the database refusing a row for the unique constraint or index called `constraint`. A unique
 * violation of another constraint, and any other error, is false, so a caller maps only the conflict it expects.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const parsed = violation.safeParse(error);
  return parsed.success && parsed.data.code === UNIQUE_VIOLATION && parsed.data.constraint === constraint;
}
