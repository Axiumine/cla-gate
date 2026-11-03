// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { StoredActiveVersion } from './cla-document-types.ts';

// How a row of `cla_versions` becomes the version the publish hands on (E12-S04). The reads of cla-version-queries.ts and the
// insert of cla-version-writes.ts select the same five columns, and the text is never one of them.

/** The columns of a version that `select` and `returning` bring back. */
export interface VersionRow {
  readonly id: number;
  readonly major: number;
  readonly minor: number;
  readonly content_sha256: string;
  readonly published_at: Date;
}

/** A row of the reads and the insert of the versions as a {@link StoredActiveVersion}. */
export function toStoredVersion(row: VersionRow): StoredActiveVersion {
  return {
    id: row.id,
    major: row.major,
    minor: row.minor,
    contentSha256: row.content_sha256,
    publishedAt: row.published_at,
  };
}
