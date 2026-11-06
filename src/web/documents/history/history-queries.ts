// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { PAGE_SIZE } from '../../../shared/cla.ts';
import { versionListRoute, versionRoute } from '../../../shared/cla-routes.ts';
import type { SuccessOf } from '../../../shared/contract.ts';
import type { ApiClient } from '../../api/index.ts';
import { type DocumentIds, documentKey } from '../document-queries.ts';

// The queries of the history of a document (E18-S11). Every key starts with `['installation', installationId, 'documents', documentId]`
// (E18-S04, E18-S05), so what is kept for one document of one tenant is dropped as a unit and never found under another.

/** A version of the history, without its text. */
export type VersionSummary = SuccessOf<typeof versionListRoute>['versions'][number];

/** A version with its exact text, as `GET .../versions/:versionId` sends it. */
export type VersionDetail = SuccessOf<typeof versionRoute>['version'];

/** One page of the history, with the rows under `items` as the paged screens of E18 hold them. */
export interface VersionPage {
  readonly items: readonly VersionSummary[];
  readonly nextCursor: string | null;
}

/** The start of the key of every query about the versions of one document: what a publish makes out of date. */
export function versionsKey(ids: DocumentIds) {
  return [...documentKey(ids), 'versions'] as const;
}

/** The params of every request about one document. */
const paramsOf = ({ installationId, documentId }: DocumentIds) => ({ installationId, documentId });

/** What one request for a page of the history asks: the document, how many versions, and from where (`undefined` is the newest). */
interface PageRequest {
  readonly ids: DocumentIds;
  readonly limit: number;
  readonly cursor: string | undefined;
}

/** Asks for `limit` versions from `cursor`: the endpoint answers `versions`, which the screens read as `items`. */
async function readPage(
  client: ApiClient,
  { ids, limit, cursor }: PageRequest,
  signal: AbortSignal,
): Promise<VersionPage> {
  const { versions, nextCursor } = await client.call(
    versionListRoute,
    { params: paramsOf(ids), query: { limit: String(limit), cursor } },
    { signal },
  );
  return { items: versions, nextCursor };
}

/**
 * `GET .../documents/:documentId/versions?limit=&cursor=` (E12-S05): the page of the history that the address names, newest number
 * first. A page is kept under its cursor and the page on screen stays until the next one is there. It is asked for again on every
 * visit and when the window gets focus, so a version another admin published shows up, with its signature count.
 */
export function versionPageQueryOptions(client: ApiClient, ids: DocumentIds, cursor: string | undefined) {
  return queryOptions({
    queryKey: [...versionsKey(ids), 'page', cursor ?? null] as const,
    queryFn: ({ signal }) => readPage(client, { ids, limit: PAGE_SIZE.default, cursor }, signal),
    staleTime: 0,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

/**
 * The versions the comparison offers: the first page with the most rows the endpoint gives, which is the newest versions. The
 * version the address names beyond them is still compared (it is read by its id), and the choice lists it by its id.
 */
export function versionChoicesQueryOptions(client: ApiClient, ids: DocumentIds) {
  return queryOptions({
    queryKey: [...versionsKey(ids), 'choices'] as const,
    queryFn: async ({ signal }) =>
      (await readPage(client, { ids, limit: PAGE_SIZE.max, cursor: undefined }, signal)).items,
    staleTime: 0,
  });
}

/** Reads one version with its text. */
async function readVersion(
  client: ApiClient,
  ids: DocumentIds,
  versionId: number,
  signal: AbortSignal,
): Promise<VersionDetail> {
  const { version } = await client.call(versionRoute, { params: { ...paramsOf(ids), versionId } }, { signal });
  return version;
}

/**
 * `GET .../documents/:documentId/versions/:versionId` (E12-S05): one version with its exact text. The server checks the text against
 * its hash first; a version that fails the check is the plain `500`, and no text is shown. A version of another tenant or document
 * is the uniform `404`.
 */
export function versionQueryOptions(client: ApiClient, ids: DocumentIds, versionId: number) {
  return queryOptions({
    queryKey: [...versionsKey(ids), versionId] as const,
    queryFn: ({ signal }) => readVersion(client, ids, versionId, signal),
  });
}

/** The two versions a comparison reads, as the ids of an address name them. */
export interface VersionPair {
  readonly from: number;
  readonly to: number;
}

/**
 * The two texts of a comparison, read together: one query, so the screen has one state for them. If either read fails, the comparison
 * fails with that error (the uniform `404` of another tenant's version, a `403`, the `500` of a text that fails the integrity check),
 * and nothing of the other text is shown.
 */
export function comparisonQueryOptions(client: ApiClient, ids: DocumentIds, pair: VersionPair) {
  return queryOptions({
    queryKey: [...versionsKey(ids), 'comparison', pair.from, pair.to] as const,
    queryFn: async ({ signal }) => {
      const [from, to] = await Promise.all([
        readVersion(client, ids, pair.from, signal),
        readVersion(client, ids, pair.to, signal),
      ]);
      return { from, to };
    },
  });
}
