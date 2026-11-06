// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions } from '@tanstack/react-query';
import { signContextRoute } from '../../shared/sign-context.ts';
import type { ApiClient } from '../api/index.ts';

// The query of the sign page (E18-S01): the context of one repository for the person who is logged in.

/** The key prefix of every context of one repository: the keys of its pull request variants all start with it. */
export function signContextScope(githubRepoId: number) {
  return ['sign', 'context', githubRepoId] as const;
}

/** The key of the context of a repository and, when the person came from one, a pull request. */
function signContextKey(githubRepoId: number, pr: number | undefined) {
  return [...signContextScope(githubRepoId), pr ?? null] as const;
}

/**
 * `GET /api/sign/:githubRepoId?pr=` (E13-S02). The text on screen is the text the person agrees to, so nothing swaps it behind
 * their back: the window getting focus or the network coming back does not ask again (the page asks again when the person
 * presses a button that says so). The cache is cleared on logout, so a context never outlives the session it was read for.
 */
export function signContextQueryOptions(client: ApiClient, githubRepoId: number, pr: number | undefined) {
  return queryOptions({
    queryKey: signContextKey(githubRepoId, pr),
    queryFn: ({ signal }) => client.call(signContextRoute, { params: { githubRepoId }, query: { pr } }, { signal }),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
