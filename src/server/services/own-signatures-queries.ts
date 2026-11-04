// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';

// What the list of a person's own signatures reads (E13-S06). The person is the reader and belongs to no tenant, so the statement
// names the person (`users.id`, from the session) and no installation: it returns the person's signatures in every tenant on
// purpose, filters on that key and on nothing the caller supplies, and writes nothing. Nothing of the personal data is joined:
// the name and the address live in `signer_pii`, and the reason and the person of a revocation are not selected.

/**
 * A place in the list: the instant of a row and its id. The instant is kept at the microsecond precision the
 * database stores (`2026-10-15T09:00:00.123456Z`), because two rows of one millisecond can be told apart only by it, and a cursor
 * that rounded it would skip or repeat them.
 */
export interface OwnSignaturePosition {
  readonly signedAt: string;
  readonly id: number;
}

/** One page asked for: how many signatures at most, and the row it starts at (`null` for the first page). */
export interface OwnSignatureRequest {
  readonly limit: number;
  readonly from: OwnSignaturePosition | null;
}

/** The instant of a signature as text, to the microsecond and in UTC, as the cursor holds it. */
const SIGNED_AT_MICROS = sql<string>`to_char(s.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The signatures from a place on, in the order of the list: the row itself, the earlier instants, and the smaller ids at its instant. */
const fromPosition = (position: OwnSignaturePosition) =>
  sql<boolean>`(s.signed_at, s.id) <= (${position.signedAt}::timestamptz, ${position.id})`;

/**
 * Every signature of the person (`users.id`) with the installation (account and state), the document with the major version in
 * force (`activeMajor`, `null` while it has none), the version signed, the repository the person signed from with its state, and
 * the lowest repository that still enforces the document (`documentGithubRepoId`). The rest is added by the caller.
 */
function signaturesOf(db: Kysely<Database>, userId: number) {
  return db
    .selectFrom('signatures as s')
    .innerJoin('installations as i', 'i.id', 's.installation_id')
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 's.document_id').onRef('d.installation_id', '=', 's.installation_id'),
    )
    .innerJoin('cla_versions as v', 'v.id', 's.version_id')
    .leftJoin('cla_versions as av', (join) =>
      join.onRef('av.id', '=', 'd.active_version_id').onRef('av.document_id', '=', 'd.id'),
    )
    .leftJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 's.source_repository_id').onRef('r.installation_id', '=', 's.installation_id'),
    )
    .select([
      's.id',
      's.major',
      's.signed_at as signedAt',
      's.revoked_at as revokedAt',
      's.source_pr_number as prNumber',
      'i.account_login as accountLogin',
      'i.account_type as accountType',
      'i.suspended_at as suspendedAt',
      'd.id as documentId',
      'd.name as documentName',
      'av.major as activeMajor',
      'v.id as versionId',
      'v.minor',
      'r.full_name as sourceFullName',
      'r.github_repo_id as sourceGithubRepoId',
      'r.removed_at as sourceRemovedAt',
    ])
    .select(SIGNED_AT_MICROS.as('signedAtMicros'))
    .select((eb) =>
      eb
        .selectFrom('repositories as dr')
        .select((inner) => inner.fn.min<number>('dr.github_repo_id').as('lowest'))
        .whereRef('dr.installation_id', '=', 's.installation_id')
        .whereRef('dr.cla_document_id', '=', 's.document_id')
        .where('dr.removed_at', 'is', null)
        .as('documentGithubRepoId'),
    )
    .where('s.user_id', '=', userId);
}

/**
 * The signatures of the person in every tenant, newest first (`signed_at desc, id desc`), starting at `request.from`, and one more
 * than the page holds: that row is where the next page starts, and without it there is none.
 */
export function ownSignatureRows(db: Kysely<Database>, userId: number, request: OwnSignatureRequest) {
  const signatures = signaturesOf(db, userId);
  return (request.from === null ? signatures : signatures.where(fromPosition(request.from)))
    .orderBy('s.signed_at', 'desc')
    .orderBy('s.id', 'desc')
    .limit(request.limit + 1)
    .execute();
}

/** One row of {@link ownSignatureRows}. */
export type OwnSignatureRow = Awaited<ReturnType<typeof ownSignatureRows>>[number];
