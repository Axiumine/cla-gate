// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { removeOverrideRoute } from '../../shared/pending-routes.ts';
import { ApiError } from '../api/index.ts';
import { useApiClient } from '../auth/hooks.ts';
import { useSingleFlight } from '../documents/use-single-flight.ts';
import { overridesKey, pendingKey } from './pending-queries.ts';

/** What a removal came to: the override is gone because of it, or was gone already. */
export type RemovalOutcome = 'removed' | 'gone';

/** The server answers `404` for an override the repository does not have: removed already, or another tenant's, which it never says apart. */
function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export interface RemoveOverrideInput {
  /** `installations.id` of the tenant in the address: the lists that the removal makes out of date are the ones of this installation. */
  readonly installationId: number;
  /** `repositories.id` of the repository the overrides are listed for: the removal is addressed through it. */
  readonly repositoryId: number;
  /** `commit_overrides.id` of the row. */
  readonly overrideId: number;
  /** Told how the removal ended, once the lists have been asked for again. */
  readonly onOutcome: (outcome: RemovalOutcome) => void;
}

/**
 * The removal of an override (E18-S08): `DELETE /api/repositories/:repositoryId/commit-overrides/:overrideId`, sent once at a time (a
 * double click is one request) and never optimistic: the row goes when the list that is asked for again no longer holds it. The
 * pending list is asked for again too, because a pull request that was green only because of the override may now be blocked. A
 * `404` (the override is gone already) is an outcome of its own and asks for the lists again too; any other failure is `failure`, for
 * the dialog to show, and leaves the lists as they are.
 */
export function useRemoveOverride({ installationId, repositoryId, overrideId, onOutcome }: RemoveOverrideInput) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: overridesKey(installationId) }),
      queryClient.invalidateQueries({ queryKey: pendingKey(installationId) }),
    ]);
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: () => client.call(removeOverrideRoute, { params: { repositoryId, overrideId } }),
    onSuccess: async () => {
      await refresh();
      onOutcome('removed');
    },
    onError: async (error) => {
      if (isGone(error)) {
        await refresh();
        onOutcome('gone');
      }
    },
  });
  const send = useSingleFlight(mutation);
  return {
    remove: () => {
      send(undefined);
    },
    reset: mutation.reset,
    pending: mutation.isPending,
    failure: mutation.isError && !isGone(mutation.error) ? mutation.error : undefined,
  };
}
