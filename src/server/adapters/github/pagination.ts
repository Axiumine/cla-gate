// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import { GitHubResponseError } from '../../services/ports/github-errors.ts';
import { GITHUB_API_ORIGIN, schemaFailure } from './github-http.ts';

// Lists that GitHub pages (E05-S04): follow `Link: rel="next"` to the end, or fail. A list cut short is never returned,
// because a repository list that lost its tail would mark those repositories removed.

/** 100 pages of 100 items: 10,000 entries, far more than an installation holds. Past it the list is refused. */
const MAX_PAGES = 100;

/** One answer of a paged route: the decoded body and the `Link` header. */
export interface Page {
  readonly data: unknown;
  readonly link: string | undefined;
}

/** Fetches a page; `undefined` is the first one, otherwise the absolute URL the previous `Link` named. */
type FetchPage = (url: string | undefined) => Promise<Page>;

const NEXT_LINK = /<([^<>]*)>\s*;\s*rel="next"/;

/** Whether a `Link` header names a next page: the one question a caller that pages by hand asks. */
export function hasNextPage(link: string | undefined): boolean {
  return link !== undefined && NEXT_LINK.test(link);
}

/**
 * The URL of the next page, or undefined on the last one. The token goes with the request, so a URL that does not
 * point at api.github.com is refused.
 */
function nextUrl(link: string | undefined, route: string): string | undefined {
  const url = link === undefined ? undefined : NEXT_LINK.exec(link)?.[1];
  if (url !== undefined && !url.startsWith(`${GITHUB_API_ORIGIN}/`)) {
    throw new GitHubResponseError(route, ['link']);
  }
  return url;
}

/**
 * Every item of a paged route, in order. `schema` reads one page's body into its items.
 * @throws GitHubResponseError for a page that fails the schema (its paths), a `Link` that leaves api.github.com
 * (`link`) and a 101st page (`pagination_limit`).
 */
export async function collectPages<T>(
  route: string,
  fetchPage: FetchPage,
  schema: z.ZodType<readonly T[]>,
): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const { data, link } = await fetchPage(url);
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw schemaFailure(route, parsed.error);
    }
    items.push(...parsed.data);
    url = nextUrl(link, route);
    if (url === undefined) {
      return items;
    }
  }
  throw new GitHubResponseError(route, ['pagination_limit']);
}
