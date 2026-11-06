// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { InstallationRole, RepositoryPage } from '../../shared/installations.ts';
import { useApiClient } from '../auth/hooks.ts';
import { scopeRepositoriesQueryOptions } from '../documents/document-queries.ts';

/** A repository of the list, as the choices need it. */
interface RepositoryChoice {
  readonly id: number;
  readonly fullName: string;
}

/** The repositories a person can choose among on the pending screen (E18-S08). */
export interface RepositoryChoices {
  /** The request of the list: its state is the state of the choices. */
  readonly query: UseQueryResult<RepositoryPage>;
  /** The first repositories of the tenant by name (for a repo admin, those they administer), once the list is there. */
  readonly items: readonly RepositoryChoice[];
  /** The tenant has more repositories than the list holds, so a repository that is not in it may still be the tenant's. */
  readonly truncated: boolean;
}

/**
 * The repositories of the tenant in the address (`GET .../repositories?limit=100`, E14-S01, the list the allowlist and the new-document
 * dialog use too), narrowed for a repo admin to the ones they administer. The list is the tenant's own, so a repository that is in it
 * belongs to this installation and no other.
 */
export function useRepositoryChoices(installationId: number, role: InstallationRole | undefined): RepositoryChoices {
  const query = useQuery(scopeRepositoriesQueryOptions(useApiClient(), installationId));
  return {
    query,
    items: (query.data?.items ?? []).filter((item) => role !== 'repo_admin' || item.canAdminister),
    truncated: (query.data?.nextCursor ?? null) !== null,
  };
}
