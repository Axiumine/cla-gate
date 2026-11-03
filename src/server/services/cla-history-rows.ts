// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import type { VersionNumber } from '../domain/version-number.ts';
import type { StoredActiveVersion } from './cla-document-types.ts';
import { toStoredVersion } from './cla-version-rows.ts';

// How a row of the reads of the history of a document becomes a version (E12-S05). The statements are in
// cla-history-queries.ts; the service that checks the text against its hash is cla-history.ts.

/** A version of the history: the fields of the active version of a document, who published it and why, whether the document points at it, and how many signatures that are not revoked were made on it. */
export interface HistoryVersion extends StoredActiveVersion {
  /** `users.github_id` and `users.login` of the person as the row holds them now: `erased-<id>` after an erasure. */
  readonly publishedBy: { readonly githubId: number; readonly login: string };
  readonly rationale: string;
  readonly active: boolean;
  readonly signatureCount: number;
}

/** A version of the history with the exact text it was published with. */
export interface HistoryVersionText extends HistoryVersion {
  readonly contentMd: string;
}

/** The columns a read of the history selects from `cla_versions as v`, `cla_documents as d` and `users as u`; the count of signatures is added beside them. */
export const HISTORY_COLUMNS = [
  'v.id',
  'v.major',
  'v.minor',
  'v.content_sha256',
  'v.rationale',
  'v.published_at',
  'u.github_id as publisher_github_id',
  'u.login as publisher_login',
  'd.active_version_id',
] as const;

/** The columns {@link HISTORY_COLUMNS} brings back, and the count of signatures, for a version of the history. */
export interface HistoryRow {
  readonly id: number;
  readonly major: number;
  readonly minor: number;
  readonly content_sha256: string;
  readonly rationale: string;
  readonly published_at: Date;
  readonly publisher_github_id: number;
  readonly publisher_login: string;
  /** What the document points at: the version is the active one when this is its own id. */
  readonly active_version_id: number | null;
  readonly signature_count: number;
}

/** The row of {@link HistoryRow} with the text. */
export interface HistoryTextRow extends HistoryRow {
  readonly content_md: string;
}

/** A row of the history as a {@link HistoryVersion}. */
export function toHistoryVersion(row: HistoryRow): HistoryVersion {
  return {
    ...toStoredVersion(row),
    publishedBy: { githubId: row.publisher_github_id, login: row.publisher_login },
    rationale: row.rationale,
    active: row.active_version_id === row.id,
    signatureCount: row.signature_count,
  };
}

/** A row of the history with the text as a {@link HistoryVersionText}. */
export function toHistoryVersionText(row: HistoryTextRow): HistoryVersionText {
  return { ...toHistoryVersion(row), contentMd: row.content_md };
}

/** The condition that keeps the versions at `position` and below in the order `major desc, minor desc`: the pair is compared as one, so no version is skipped or repeated between pages. */
export function atOrBelow(position: VersionNumber) {
  return sql<boolean>`(v.major, v.minor) <= (${position.major}, ${position.minor})`;
}
