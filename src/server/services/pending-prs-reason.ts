// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Expression, type SqlBool, sql } from 'kysely';
import type { PendingReasonCode } from '../../shared/pending-prs.ts';
import { FAILURE_CODES } from '../../shared/pr-evaluation-codes.ts';

// The filter on a reason of the list of pending pull requests (E15-S07), as a condition on the stored details of a row.

/** The stored details of a row of version 1 that lists `code` among its failure codes: the document `details` has to contain. */
function listsCode(details: Expression<unknown>, code: string): Expression<SqlBool> {
  return sql<SqlBool>`${details} @> ${JSON.stringify({ version: 1, failureCodes: [code] })}::jsonb`;
}

/**
 * The condition "a reason with this code is listed" on the stored details of a row, the one `pendingReasons` (domain/pending-reasons.ts)
 * agrees with for every value the engine or the dead-letter write stores: each failure code of the engine gives at least one reason
 * of its own code, so a code is listed exactly when the details list it, and `other` is what no code of the engine is listed for.
 */
export function reasonCondition(details: Expression<unknown>, reason: PendingReasonCode): Expression<SqlBool> {
  if (reason !== 'other') {
    return listsCode(details, reason);
  }
  return sql<SqlBool>`not (${sql.join(
    FAILURE_CODES.map((code) => listsCode(details, code)),
    sql` or `,
  )})`;
}
