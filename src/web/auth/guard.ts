// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { QueryClient } from '@tanstack/react-query';
import { authFor } from './auth.ts';
import { navigateToPage } from './navigate.ts';
import { loginStartUrl } from './return-to.ts';
import { sessionQueryOptions } from './session.ts';

// The guard of an `authenticated` route (E17-S08): it runs before the route loads, so nothing of a screen that needs a
// login is rendered or fetched for someone who is not logged in.

/** What the guard needs of the router's `beforeLoad` argument: the query client of the context and where the visit is. */
export interface GuardInput {
  readonly context: { readonly queryClient: QueryClient };
  readonly location: { readonly pathname: string; readonly searchStr: string };
}

/** Never settles: the page is being replaced, so the router waits and shows nothing instead of flashing a screen or an error. */
const PAGE_IS_LEAVING = new Promise<never>(() => undefined);

/**
 * `beforeLoad` of an `authenticated` route. The session comes from the query cache whatever its age (one request, shared with
 * the user menu); only when the cache holds none is the server asked.
 * Someone who is not logged in is sent to the login start by a full-page navigation, not by the router, with `return_to` set
 * to the path and search of the page they asked for; a failure to learn the session is the route's error, not a login.
 */
export async function requireSession({ context, location }: GuardInput): Promise<void> {
  const { queryClient } = context;
  const session = await queryClient.query({
    ...sessionQueryOptions(authFor(queryClient).client),
    staleTime: 'static',
  });
  if (!session.authenticated) {
    navigateToPage(loginStartUrl(`${location.pathname}${location.searchStr}`));
    await PAGE_IS_LEAVING;
  }
}
