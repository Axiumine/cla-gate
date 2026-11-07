// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQuery } from '@tanstack/react-query';
import { corporateAvailabilityRoute, corporateClaimRoute } from '../../shared/corporate-claims.ts';
import { useApiClient } from '../auth/index.ts';

/**
 * Whether the repository offers the claim of an employee (E21-S04): the one fact the entry "Contributing for an employer?" is shown on. The
 * answer names no company and no agreement. A failure to ask is no answer, so the entry stays out of the page.
 */
export function useAvailability(githubRepoId: number) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['corporate', 'availability', githubRepoId],
    queryFn: ({ signal }) => client.call(corporateAvailabilityRoute, { params: { githubRepoId } }, { signal }),
  });
}

/** The claim itself (E21-S04): the confirmation the person ticked is the whole body. Both successes are "covered" for the person. */
export function useClaim(githubRepoId: number) {
  const client = useApiClient();
  return useMutation({
    mutationFn: () => client.call(corporateClaimRoute, { params: { githubRepoId }, body: { confirm: true } }),
  });
}
