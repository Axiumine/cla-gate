// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type RawBuilder, type SqlBool, sql } from 'kysely';
import type { SignatureExportState } from '../../../shared/signature-export.ts';

// Which signatures of a document the export takes (E16-S03): the filter a caller asks for and the SQL conditions it stands for.
// The statements that use them are in signature-queries.ts, and filter by tenant and document there.

/** The signatures of one document the export is asked for. */
export interface SignatureFilter {
  /** `cla_documents.id`. */
  readonly documentId: number;
  readonly state: SignatureExportState;
  /** Inclusive, on `signed_at`. */
  readonly from?: Date | undefined;
  /** Exclusive, on `signed_at`. */
  readonly to?: Date | undefined;
}

/**
 * The condition of a state, in the words of `signatureState` (src/server/domain/signature-state.ts): revoked is a set
 * `revoked_at`; outdated is not revoked and below the active major of the document; active is not revoked and not below it,
 * which a document with no active version satisfies. `av` is the active version of the document `d`, absent when there is none.
 * A test holds this statement and the function to the same answer. The search of E15-S02 uses it too.
 */
export function stateCondition(state: SignatureExportState): RawBuilder<SqlBool> {
  switch (state) {
    case 'all':
      return sql<SqlBool>`true`;
    case 'revoked':
      return sql<SqlBool>`s.revoked_at is not null`;
    case 'outdated':
      return sql<SqlBool>`s.revoked_at is null and av.major is not null and s.major < av.major`;
    case 'active':
      return sql<SqlBool>`s.revoked_at is null and (av.major is null or s.major >= av.major)`;
  }
}

/** The conditions of the filter beyond the tenant and the document: the state, and the bounds on `signed_at` at the millisecond. */
export function filterConditions(filter: SignatureFilter): RawBuilder<SqlBool>[] {
  const { from, to, state } = filter;
  return [
    stateCondition(state),
    ...(from === undefined ? [] : [sql<SqlBool>`s.signed_at >= ${from.toISOString()}::timestamptz`]),
    ...(to === undefined ? [] : [sql<SqlBool>`s.signed_at < ${to.toISOString()}::timestamptz`]),
  ];
}
