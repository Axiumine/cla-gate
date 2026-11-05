// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queryOptions } from '@tanstack/react-query';
import type { ClaRule } from '../../shared/cla.ts';
import { badgeSnippetRoute } from '../../shared/public-verification.ts';
import { type ApiClient, ApiError } from '../api/index.ts';

// What the settings screen of a repository knows about its public badge (E22-S03), read from the one call that tells both things:
// the snippet is the answer while the maintainers have opted in, and the `409 public_verification_disabled` is the answer while they have not.

/** The repository a settings screen is about: the row ids of the address, as `PUT .../public-verification` and the snippet take them. */
export interface RepositoryIds {
  readonly installationId: number;
  readonly repositoryId: number;
}

/** The opt-in is off, or it is on and this is what to paste into a README. */
type BadgeState =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly markdown: string; readonly html: string };

/** The rule the server answers the snippet with while the opt-in is off. */
const DISABLED: ClaRule = 'public_verification_disabled';

/**
 * The key of the badge query of a repository: its own, per installation and repository, so a screen never shows the state of the
 * one it was opened on before.
 */
export const badgeKey = (ids: RepositoryIds) => ['repository-badge', ids.installationId, ids.repositoryId] as const;

/**
 * The badge query: `GET .../badge-snippet` through the typed client. The `409` that says the opt-in is off is an answer and not a
 * failure, so the screen can show the switch off; any other failure (a `403`, a `404`, an outage) stays one.
 */
export function badgeQueryOptions(client: ApiClient, ids: RepositoryIds) {
  return queryOptions({
    queryKey: badgeKey(ids),
    queryFn: async ({ signal }): Promise<BadgeState> => {
      try {
        const snippet = await client.call(badgeSnippetRoute, { params: ids }, { signal });
        return { enabled: true, ...snippet };
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.code === DISABLED) {
          return { enabled: false };
        }
        throw error;
      }
    },
  });
}
