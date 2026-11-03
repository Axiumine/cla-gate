// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { DocumentRow, StoredDocument } from './cla-document-types.ts';

// How a row of the reads of the CLA documents becomes a document (E12-S01). The shapes are in cla-document-types.ts, the
// statements in cla-document-queries.ts and cla-document-writes.ts.

/** The columns of the active version, which a left join leaves null for a document that has none; the key makes the rest present. */
const versionColumns = z.object({
  version_id: z.int(),
  major: z.int(),
  minor: z.int(),
  content_sha256: z.string(),
  published_at: z.date(),
});

/** A row of the select of the reads as a {@link StoredDocument}. */
export function toDocument(row: DocumentRow): StoredDocument {
  const version = row.version_id === null ? null : versionColumns.parse(row);
  return {
    id: row.id,
    repositoryId: row.repository_id,
    name: row.name,
    kind: row.kind,
    activeVersion:
      version === null
        ? null
        : {
            id: version.version_id,
            major: version.major,
            minor: version.minor,
            contentSha256: version.content_sha256,
            publishedAt: version.published_at,
          },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
