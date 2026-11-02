// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { isList } from '../ci/lib/guard-types.ts';

// The read-only HTTP layer behind the skip decision of the nightly mutation run (E20-S04), made through an injected `fetch`
// so that tests need no network. GET only. Every answer is checked before it is trusted: a status other than 200, a body of
// an unexpected shape and a list that is longer than the caps below all end in an `UndecidedError`, which the caller turns
// into "do not skip". Nothing here prints, and no message holds the token, a header or a response body.

/** What the decision reads of a response: its status and its JSON body. The real `Response` of `fetch` has both. */
interface HttpResponse {
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

export interface HttpInit {
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

/** The part of `fetch` this module uses. */
export type Fetcher = (url: string, init: HttpInit) => Promise<HttpResponse>;

/** A reason not to skip whose text is safe to print: it never holds the token, a header or a response body. */
export class UndecidedError extends Error {}

/** Where to ask, and how. */
export interface Source {
  readonly fetcher: Fetcher;
  /** One signal for the whole lookup, so that a slow API cannot hold the job. */
  readonly signal: AbortSignal;
  /** `GITHUB_API_URL` without a trailing slash. */
  readonly apiUrl: string;
  /** `owner/name`, already checked against a pattern that cannot change the path of a request. */
  readonly repository: string;
  /** The job token; empty means an anonymous request (a public repository, a local smoke check). */
  readonly token: string;
}

/** The largest page the API serves. */
export const PER_PAGE = 100;
/** Pages read per list; a list that is longer than this many full pages is a reason not to skip. */
export const MAX_PAGES = 3;

export type Item = Readonly<Record<string, unknown>>;

function isItem(value: unknown): value is Item {
  return typeof value === 'object' && value !== null && !isList(value);
}

export interface Listing {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  /** The field of the response that holds the list. */
  readonly key: string;
  /** What is being listed, for the messages. */
  readonly what: string;
}

function headersOf(token: string): Readonly<Record<string, string>> {
  const base = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  return token === '' ? base : { ...base, Authorization: `Bearer ${token}` };
}

/** One page of a listing: the items of the list it holds, or an `UndecidedError` for a status or a shape that is not expected. */
async function pageOf(source: Source, listing: Listing, page: number): Promise<readonly Item[]> {
  const url = new URL(`${source.apiUrl}${listing.path}`);
  for (const [name, value] of Object.entries({ ...listing.query, per_page: String(PER_PAGE), page: String(page) })) {
    url.searchParams.set(name, value);
  }
  const response = await source.fetcher(url.href, {
    method: 'GET',
    headers: headersOf(source.token),
    signal: source.signal,
  });
  if (response.status !== 200) {
    throw new UndecidedError(`${listing.what}: the API answered HTTP ${response.status}`);
  }
  const body = await response.json();
  const list = isItem(body) ? body[listing.key] : undefined;
  if (!isList(list) || !list.every(isItem)) {
    throw new UndecidedError(`${listing.what}: the answer has an unexpected shape`);
  }
  return list;
}

/** Every item of a listing, page by page and only as far as the caller reads; more than MAX_PAGES full pages is an error. */
export async function* itemsOf(source: Source, listing: Listing): AsyncGenerator<Item> {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const items = await pageOf(source, listing, page);
    yield* items;
    if (items.length < PER_PAGE) {
      return;
    }
  }
  throw new UndecidedError(`${listing.what}: more than ${MAX_PAGES} pages, so the search stopped`);
}
