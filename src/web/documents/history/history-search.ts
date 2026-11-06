// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { VersionPair } from './history-queries.ts';

// What the address of a document holds (E18-S05, E18-S11): `/installations/$installationId/documents/$documentId?tab=&view=&compare=&from=&to=&cursor=`,
// the tab, what the history shows and the page of it, so a reload, a pasted link and the browser's Back land on the same view. Every
// value is checked and a value that is not one is dropped: the screen then shows what it would without it.

/** The longest `cursor` the endpoint reads (1 to 1024 characters, the bound of every paged list). */
const MAX_CURSOR_LENGTH = 1024;

/** A version id (`cla_versions.id`) as a positive whole number. It is only ever sent in a request the server filters by tenant and document. */
const versionId = z.int().positive().optional().catch(undefined);

/**
 * `?tab=history` is the second tab and no `tab` is the first. `?view=` is the version whose text is read. `?compare=true` opens the
 * comparison, with `?from=` and `?to=` the two versions: a pair that is not two valid ids is the default pair (the active version
 * against the one before it). `?cursor=` is the page of the history, a text of the length the endpoint takes, kept and handed back,
 * never read.
 */
export const documentSearchSchema = z.object({
  tab: z.literal('history').optional().catch(undefined),
  view: versionId,
  compare: z.literal(true).optional().catch(undefined),
  from: versionId,
  to: versionId,
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional().catch(undefined),
});

export type DocumentSearch = z.infer<typeof documentSearchSchema>;

/** The two tabs of a document. */
export type DocumentTab = 'editor' | 'history';

/** The tab an address names. */
export function tabOf(search: DocumentSearch): DocumentTab {
  return search.tab ?? 'editor';
}

/** The tab a Radix value stands for: `history` is the second one, anything else the first. */
export function tabFromValue(value: string): DocumentTab {
  return value === 'history' ? 'history' : 'editor';
}

/** What the history shows under the list: one version's text, the comparison (on a pair of the address, or the default one), or nothing. */
export type HistoryPanel =
  | { readonly type: 'view'; readonly versionId: number }
  | { readonly type: 'compare'; readonly pair: VersionPair | undefined }
  | { readonly type: 'none' };

/** The pair of the address when it holds two ids, else `undefined`: a half pair is no pair, and the comparison starts from its default one. */
function pairOf(search: DocumentSearch): VersionPair | undefined {
  return search.from !== undefined && search.to !== undefined ? { from: search.from, to: search.to } : undefined;
}

/** The panel an address names. A version in the address wins over the comparison, so a hand-written address opens one thing. */
export function panelOf(search: DocumentSearch): HistoryPanel {
  if (search.view !== undefined) {
    return { type: 'view', versionId: search.view };
  }
  return search.compare === true ? { type: 'compare', pair: pairOf(search) } : { type: 'none' };
}

/** How the address changes: a function of the address it has, so a change keeps what it does not name (the page of the list, for one). */
export type SearchUpdate = (previous: DocumentSearch) => DocumentSearch;

/** Changes the address; `replace` swaps the entry of the history instead of adding one. */
export type OnSearch = (update: SearchUpdate, replace?: boolean) => void;

/** The address of a tab: the history starts clean, and the editor has no parameters of its own. */
export function toTab(tab: DocumentTab): SearchUpdate {
  return () => (tab === 'history' ? { tab } : {});
}

/** The address with one version's text open: the comparison closes, and the page of the list stays. */
export function toVersion(versionId: number): SearchUpdate {
  return (previous) => ({ tab: 'history', view: versionId, cursor: previous.cursor });
}

/** The address with the comparison open, on `pair` or, with none, on the default pair: the open version closes, and the page of the list stays. */
export function toComparison(pair?: VersionPair): SearchUpdate {
  return (previous) => ({ tab: 'history', compare: true, ...pair, cursor: previous.cursor });
}

/** The address with nothing open under the list. */
export const toList: SearchUpdate = (previous) => ({ tab: 'history', cursor: previous.cursor });

/** The address on another page of the list, with the rest as it is (`undefined` is the first page). */
export function toCursor(cursor: string | undefined): SearchUpdate {
  return (previous) => ({ ...previous, cursor });
}
