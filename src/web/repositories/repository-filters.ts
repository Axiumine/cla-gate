// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { REPOSITORY_SEARCH_MAX_LENGTH } from '../../shared/installations.ts';
import { searchTextOf } from '../ui/search-text.ts';

// What the Repositories screen filters by (E18-S10), and how a search text becomes the `q` of the endpoint.

/** What the address of the screen holds, once validated: the search text and whether to list only enabled (`true`) or only disabled (`false`) repositories. */
export interface Filters {
  readonly q: string | undefined;
  readonly enabled: boolean | undefined;
}

/**
 * The search text as the screen uses it: trimmed, and `undefined` when nothing is left or the text is one the endpoint refuses
 * (longer than a full name can be, a lone surrogate or a NUL, which the database cannot hold). It is the one rule of the input and of
 * the address, so a text that cannot be sent is no search at all instead of a `400`.
 */
export function queryOf(text: string): string | undefined {
  return searchTextOf(text, REPOSITORY_SEARCH_MAX_LENGTH);
}

/** Whether any filter narrows the list. */
export function isFiltered(filters: Filters): boolean {
  return filters.q !== undefined || filters.enabled !== undefined;
}

/** A text that is the same for the same filters and different for different ones: it keys what belongs to one search. */
export function filterKey(filters: Filters): string {
  return JSON.stringify([filters.q ?? null, filters.enabled ?? null]);
}

/** The value of the choice that is no filter. */
export const ALL = '';

/** The filter a chosen value stands for: `true` or `false`, and nothing (all repositories) for any other. */
export function enabledOf(value: string): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  return value === 'false' ? false : undefined;
}

/** The value of the select for a filter: the text `enabledOf` reads back. */
export function enabledValue(enabled: boolean | undefined): string {
  return enabled === undefined ? ALL : String(enabled);
}
