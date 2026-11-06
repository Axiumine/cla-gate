// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SIGNATURE_SEARCH_MAX_LOGIN } from '../../shared/signature-search.ts';
import { searchTextOf } from '../ui/search-text.ts';

// What the signatures screen filters by (E18-S07), and how a search text becomes one of the two exact filters of the endpoint.

/** The states a search can be narrowed to; `all` is no filter, so it is not one of them. */
export const STATE_FILTERS = ['active', 'outdated', 'revoked'] as const;

export type StateFilter = (typeof STATE_FILTERS)[number];

/** What the address of the screen holds, once validated: the search text, the status and the document (`cla_documents.id`). */
export interface Filters {
  readonly q: string | undefined;
  readonly state: StateFilter | undefined;
  readonly document: number | undefined;
}

/**
 * The search text as the screen uses it: trimmed, and `undefined` when nothing is left or the text is one the endpoint refuses
 * (longer than a login can be, a lone surrogate or a NUL, which the database cannot hold). It is the one rule of the input and
 * of the address, so a text that cannot be sent is no search at all instead of a `400`.
 */
export function queryOf(text: string): string | undefined {
  return searchTextOf(text, SIGNATURE_SEARCH_MAX_LOGIN);
}

/** A positive whole number in plain digits that a number holds exactly: what `users.github_id` can be. */
const GITHUB_ID = /^[1-9]\d*$/;

/** The one exact filter a search text stands for: `githubUserId` or `login`, never both and never a prefix. */
export interface ExactFilter {
  readonly githubUserId: number | undefined;
  readonly login: string | undefined;
}

/**
 * Which filter of the endpoint a search text is. A text of digits is the numeric GitHub id of the signer; anything else is a login,
 * which the server matches exactly and in any case. A text of digits that cannot be an id (a leading zero, zero, more than a
 * number holds) is a login too: GitHub has accounts named with digits, and sending an id the server refuses would be an error
 * where the answer is "nobody".
 */
export function exactFilterOf(q: string | undefined): ExactFilter {
  if (q === undefined) {
    return { githubUserId: undefined, login: undefined };
  }
  const id = GITHUB_ID.test(q) ? Number(q) : undefined;
  return id !== undefined && Number.isSafeInteger(id)
    ? { githubUserId: id, login: undefined }
    : { githubUserId: undefined, login: q };
}

/** Whether any filter narrows the list. */
export function isFiltered(filters: Filters): boolean {
  return filters.q !== undefined || filters.state !== undefined || filters.document !== undefined;
}

/** A text that is the same for the same filters and different for different ones: it keys what belongs to one search. */
export function filterKey(filters: Filters): string {
  return JSON.stringify([filters.q ?? null, filters.state ?? null, filters.document ?? null]);
}
