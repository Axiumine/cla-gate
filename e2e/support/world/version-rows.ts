// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { DOCUMENTS, VERSIONS } from './ids.ts';
import { at, insertRow, sha256Of } from './insert.ts';
import { TEXT_OTHER, TEXT_SHORT, TEXT_V1, TEXT_V1_1, TEXT_V2 } from './text.ts';

// E18-S12: the published versions of the seeded documents, each with the time and the reason it was published.

export interface VersionSpec {
  readonly id: number;
  readonly documentId: number;
  readonly major: number;
  readonly minor: number;
  readonly text: string;
  readonly rationale: string;
  readonly publishedBy: number;
  readonly publishedAt: string;
}

export async function version(db: Kysely<Database>, spec: VersionSpec): Promise<void> {
  await insertRow(db, 'cla_versions', {
    id: spec.id,
    document_id: spec.documentId,
    major: spec.major,
    minor: spec.minor,
    content_md: spec.text,
    content_sha256: sha256Of(spec.text),
    published_by: spec.publishedBy,
    rationale: spec.rationale,
    published_at: at(spec.publishedAt),
  });
}

/** The three versions of the individual CLA: two majors, one of them with a minor. */
export function individualVersions(alice: number): readonly VersionSpec[] {
  const published = { publishedBy: alice, minor: 0 };
  return [
    {
      ...published,
      id: VERSIONS.v1,
      documentId: DOCUMENTS.individual.id,
      major: 1,
      text: TEXT_V1,
      rationale: 'First version.',
      publishedAt: '2026-01-12T10:00:00Z',
    },
    {
      ...published,
      id: VERSIONS.v1_1,
      documentId: DOCUMENTS.individual.id,
      major: 1,
      minor: 1,
      text: TEXT_V1_1,
      rationale: 'Added a third item to the scope list.',
      publishedAt: '2026-02-03T14:30:00Z',
    },
    {
      ...published,
      id: VERSIONS.v2,
      documentId: DOCUMENTS.individual.id,
      major: 2,
      text: TEXT_V2,
      rationale: 'A new section about employers: everyone signs again.',
      publishedAt: '2026-03-10T09:45:00Z',
    },
  ];
}

/** The version of the document with the hostile name, and the one of the other tenant. */
export function otherVersions(alice: number, bob: number): readonly VersionSpec[] {
  const published = { publishedBy: alice, minor: 0 };
  return [
    {
      ...published,
      id: VERSIONS.hostile,
      documentId: DOCUMENTS.hostile.id,
      major: 1,
      text: TEXT_SHORT,
      rationale: '<script>alert(1)</script> The reason is text.',
      publishedAt: '2026-02-20T12:00:00Z',
    },
    {
      ...published,
      id: VERSIONS.foreign,
      documentId: DOCUMENTS.foreign.id,
      major: 1,
      text: TEXT_OTHER,
      rationale: 'First version of the other tenant.',
      publishedBy: bob,
      publishedAt: '2026-01-15T10:00:00Z',
    },
  ];
}
