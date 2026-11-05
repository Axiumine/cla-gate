// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type RawBuilder, type SqlBool, sql } from 'kysely';
import type { SignatureExportState } from '../../shared/signature-export.ts';
import { stateCondition } from './export/signature-filter.ts';

// What the search for signatures asks for (E15-S02): the filter, the page and the place a page starts at, and the SQL conditions they stand
// for. The statement that reads is in signature-search-queries.ts and names the installation of the tenant.

/**
 * A place in the list: the instant of a row and its id. The instant is kept at the microsecond precision the database stores
 * (`2026-10-15T09:00:00.123456Z`), because two rows of one millisecond can be told apart only by it, and a cursor that rounded it
 * would skip or repeat them.
 */
export interface SignaturePosition {
  readonly signedAt: string;
  readonly id: number;
}

/** Which signatures of the tenant a search takes. */
export interface SearchFilter {
  /** Only the signatures of these documents (`cla_documents.id`), or `null` for every document of the tenant. An empty list takes none. */
  readonly documentIds: readonly number[] | null;
  readonly state: SignatureExportState;
  /** `users.github_id` of the signer: an exact match. */
  readonly githubUserId: number | null;
  /** The login the signer gave when signing (`signer_pii.login`): an exact match, whatever the case, and never a prefix. */
  readonly login: string | null;
}

/** One page asked for: how many signatures at most, and the row it starts at (`null` for the first page). */
export interface SearchPage {
  readonly limit: number;
  readonly from: SignaturePosition | null;
}

/** The conditions of the filter beyond the tenant and the documents: the state, the signer's id and the login. */
export function searchConditions(filter: SearchFilter): RawBuilder<SqlBool>[] {
  const { state, githubUserId, login } = filter;
  return [
    stateCondition(state),
    ...(githubUserId === null ? [] : [sql<SqlBool>`u.github_id = ${githubUserId}`]),
    ...(login === null ? [] : [sql<SqlBool>`lower(p.login) = lower(${login})`]),
  ];
}

/** The condition that keeps the rows from `position` on, that row included, in the order `signed_at desc, id desc`. */
export const fromPosition = (position: SignaturePosition): RawBuilder<SqlBool> =>
  sql<SqlBool>`(s.signed_at, s.id) <= (${position.signedAt}::timestamptz, ${position.id})`;
