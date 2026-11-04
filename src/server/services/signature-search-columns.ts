// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';

// The columns of the search for signatures (E15-S02), apart from the joins and the filters (signature-search-queries.ts): the aliases
// are the names of the fields of a row (signature-search-item.ts). The tables are named by the aliases the statement gives them:
// the signature `s`, the signer `u`, who revoked it `ru`, the document `d` and its version in force `av`, the version signed `v`, the
// repository signed from `r` and the personal data held for the signature `p`.

/** What a row of the search holds of the tables, which Kysely reads the types of from the names. */
export const SEARCH_COLUMNS = [
  's.id',
  's.major',
  's.signed_at as signedAt',
  's.revoked_at as revokedAt',
  's.revoke_reason as revokeReason',
  's.source_pr_number as prNumber',
  'u.github_id as githubUserId',
  'ru.github_id as revokedByGithubId',
  'd.id as documentId',
  'd.name as documentName',
  'av.major as activeMajor',
  'v.minor',
  'r.full_name as sourceFullName',
  'p.login as piiLogin',
  'p.name as piiName',
  'p.email as piiEmail',
] as const;

/** The instant of a signature as text, to the microsecond and in UTC, as the cursor holds it. */
export const SIGNED_AT_MICROS =
  sql<string>`to_char(s.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('signedAtMicros');
