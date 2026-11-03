// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// A repository of the list as the queries of E14-S01 read it, and how a row of those queries becomes one. No statement is
// made here: the rows come from `repository-list-queries.ts`, which names the installation in every one of them.

/** Where a page starts: the full name and id of its first repository, the pair the list is ordered by. */
export interface RepositoryPosition {
  readonly fullName: string;
  readonly id: number;
}

/** The CLA document a repository enforces, as the list shows it. `repositoryId` is set for a document scoped to a repository. */
export interface ListedDocument {
  readonly id: number;
  readonly name: string;
  readonly repositoryId: number | null;
  readonly activeVersion: { readonly major: number; readonly minor: number } | null;
}

/** One repository as the list reads it. `githubInstallationId` is the handle of the role lookups, never shown. */
export interface RepositoryEntry {
  readonly id: number;
  readonly githubRepoId: number;
  readonly fullName: string;
  readonly enabled: boolean;
  readonly githubInstallationId: number;
  readonly document: ListedDocument | null;
}

/** A row of the list query: the repository, and the columns of the document and of its active version, null where there is none. */
export interface EntryRow {
  readonly id: number;
  readonly github_repo_id: number;
  readonly full_name: string;
  readonly enabled: boolean;
  readonly github_installation_id: number;
  readonly document_id: number | null;
  readonly document_name: string | null;
  readonly document_repository_id: number | null;
  readonly major: number | null;
  readonly minor: number | null;
}

/** The columns of the group of the attached document, which a left join leaves null for a repository that has none. */
const documentColumns = z.object({
  document_id: z.int(),
  document_name: z.string(),
  document_repository_id: z.int().nullable(),
});

/** The columns of the active version of that document, null for a document that has none. */
const versionColumns = z.object({ major: z.int(), minor: z.int() });

/** A row of the list query as a {@link RepositoryEntry}. */
export function toEntry(row: EntryRow): RepositoryEntry {
  const document = row.document_id === null ? null : documentColumns.parse(row);
  const version = row.major === null ? null : versionColumns.parse(row);
  return {
    id: row.id,
    githubRepoId: row.github_repo_id,
    fullName: row.full_name,
    enabled: row.enabled,
    githubInstallationId: row.github_installation_id,
    document:
      document === null
        ? null
        : {
            id: document.document_id,
            name: document.document_name,
            repositoryId: document.document_repository_id,
            activeVersion: version,
          },
  };
}

/** Where the page after one that ended before `entry` starts: `entry` itself, or null when the list ended. */
export function positionOf(entry: RepositoryEntry | undefined): RepositoryPosition | null {
  return entry === undefined ? null : { fullName: entry.fullName, id: entry.id };
}
