// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions } from '@tanstack/react-query';
import { MAX_DOCUMENTS_PER_INSTALLATION } from '../../shared/cla.ts';
import { documentListRoute, documentRoute, readDraftRoute, versionRoute } from '../../shared/cla-routes.ts';
import type { SuccessOf } from '../../shared/contract.ts';
import { installationRepositoriesRoute } from '../../shared/installations.ts';
import type { ApiClient } from '../api/index.ts';
import { installationKey } from '../installations/installation-queries.ts';

// The queries of the document screens (E18-S05). Every key starts with `['installation', installationId]` (E18-S04), so the data of
// one tenant is kept and dropped as a unit and never found under another tenant's key.

/** The start of the key of every query about the documents of one installation. */
function documentsKey(installationId: number) {
  return [...installationKey(installationId), 'documents'] as const;
}

/** The key of the list of documents of one installation: what a create, a save or a discard makes out of date. */
export function documentListKey(installationId: number) {
  return [...documentsKey(installationId), 'list'] as const;
}

/**
 * How many documents one request asks for: an installation holds at most `MAX_DOCUMENTS_PER_INSTALLATION` (E12-S01), and that is not more than a
 * page can hold, so the one page is the whole list and the screen needs no pager.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const DOCUMENTS_PAGE = MAX_DOCUMENTS_PER_INSTALLATION;

/** `GET /api/installations/:installationId/documents?limit=100` (E12-S01): every document of the installation. */
export function documentsQueryOptions(client: ApiClient, installationId: number) {
  return queryOptions({
    queryKey: documentListKey(installationId),
    queryFn: ({ signal }) =>
      client.call(
        documentListRoute,
        { params: { installationId }, query: { limit: String(DOCUMENTS_PAGE) } },
        { signal },
      ),
  });
}

/**
 * How many repositories the scope choice of the new-document dialog lists: the most a page holds. A tenant with more says so in
 * the dialog, and a document of one of the others is made from that repository (E18-S10).
 */
export const SCOPE_REPOSITORIES = 100;

/** `GET .../repositories?limit=100` (E14-S01): the repositories a document can be scoped to, by name. */
export function scopeRepositoriesQueryOptions(client: ApiClient, installationId: number) {
  return queryOptions({
    queryKey: [...installationKey(installationId), 'repositories', { limit: SCOPE_REPOSITORIES }] as const,
    queryFn: ({ signal }) =>
      client.call(
        installationRepositoriesRoute,
        { params: { installationId }, query: { limit: String(SCOPE_REPOSITORIES) } },
        { signal },
      ),
  });
}

/** The ids in the path of every request about one document. */
export interface DocumentIds {
  readonly installationId: number;
  readonly documentId: number;
}

const idsOf = ({ installationId, documentId }: DocumentIds) => ({ installationId, documentId });

/** A document with its active version and whether a draft is saved, as `GET .../documents/:documentId` answers. */
export type DocumentDetail = SuccessOf<typeof documentRoute>['document'];

/** The saved draft with its text and revision, or `null` when none is saved. */
type SavedDraft = SuccessOf<typeof readDraftRoute>['draft'];

/** What the editor opens with, and what "Load latest" reads again (E18-S05). */
export interface EditorSeed {
  readonly document: DocumentDetail;
  readonly draft: SavedDraft;
  /** The text of the active version: what the editor shows while no draft is saved, and `''` for a document with no version. */
  readonly activeText: string;
}

/**
 * Reads the document, its draft and the text of its active version: what the editor opens with, and what "Load latest" reads
 * again. The draft and the version are read at the same moment and may have moved on by the time the person looks; the server
 * decides on every save and publish (`draft_conflict`, `stale_active_version`).
 */
export async function readEditorSeed(client: ApiClient, ids: DocumentIds, signal?: AbortSignal): Promise<EditorSeed> {
  const params = idsOf(ids);
  const [{ document }, { draft }] = await Promise.all([
    client.call(documentRoute, { params }, { signal }),
    client.call(readDraftRoute, { params }, { signal }),
  ]);
  if (document.activeVersion === null) {
    return { document, draft, activeText: '' };
  }
  const { version } = await client.call(
    versionRoute,
    { params: { ...params, versionId: document.activeVersion.id } },
    { signal },
  );
  return { document, draft, activeText: version.contentMd };
}

/**
 * The query that opens the editor. The answer holds the text of a draft and of a version that the person is about to edit, so it is
 * kept for no longer than the editor is open (`gcTime: 0`) and never asked for again behind the person's back (`staleTime: 0`, no
 * refetch on focus or reconnect): a swap of the text on screen is something the person chooses ("Load latest").
 */
export function editorSeedQueryOptions(client: ApiClient, ids: DocumentIds) {
  return queryOptions({
    queryKey: [...documentsKey(ids.installationId), ids.documentId, 'editor'] as const,
    queryFn: ({ signal }) => readEditorSeed(client, ids, signal),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
