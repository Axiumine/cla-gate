// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ClaDocumentKind } from '../../shared/cla.ts';

// The shapes of the CLA documents of a tenant as the services handle them (E12-S01).

/** The version a document is signed against, as stored. */
export interface StoredActiveVersion {
  readonly id: number;
  readonly major: number;
  readonly minor: number;
  readonly contentSha256: string;
  readonly publishedAt: Date;
}

/** A document of a tenant with its active version, if it has one. */
export interface StoredDocument {
  readonly id: number;
  /** `repositories.id` of the repository the document is scoped to, or null for a document that covers the installation. */
  readonly repositoryId: number | null;
  readonly name: string;
  readonly kind: ClaDocumentKind;
  readonly activeVersion: StoredActiveVersion | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Where a page of documents starts: at the document with this name and id, in the order `name asc, id asc`. */
export interface DocumentPosition {
  readonly name: string;
  readonly id: number;
}

/** What `listRepositoryDocuments` answers: the documents of the repository and those of the installation that cover it. */
export interface RepositoryDocuments {
  readonly repositoryScoped: readonly StoredDocument[];
  readonly installationScoped: readonly StoredDocument[];
}

/** One row of the select of the reads (`selectDocuments`, cla-document-queries.ts): the version columns are null when the document has none. */
export interface DocumentRow {
  readonly id: number;
  readonly repository_id: number | null;
  readonly name: string;
  readonly kind: ClaDocumentKind;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly version_id: number | null;
  readonly major: number | null;
  readonly minor: number | null;
  readonly content_sha256: string | null;
  readonly published_at: Date | null;
}
