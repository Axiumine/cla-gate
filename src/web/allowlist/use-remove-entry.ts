// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { removeEntryRoute } from '../../shared/allowlist-routes.ts';
import { ApiError } from '../api/index.ts';
import { useApiClient } from '../auth/hooks.ts';
import { useSingleFlight } from '../documents/use-single-flight.ts';
import { allowlistKey, type Entry } from './allowlist-queries.ts';

/** What a removal came to: the entry is gone because of it, or was gone already. */
export type RemovalOutcome = 'removed' | 'gone';

/** The server answers `404` for an entry the tenant does not have: removed already, or another tenant's, which it never says apart. */
function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export interface RemoveEntryInput {
  /** `installations.id` of the tenant in the address: the removal is addressed through it. */
  readonly installationId: number;
  /** Told how a removal ended, once the list has been asked for again. */
  readonly onOutcome: (outcome: RemovalOutcome) => void;
}

/**
 * The removal of an entry (E18-S06): `DELETE .../installations/:installationId/allowlist-entries/:entryId`, sent once at a time (a double
 * click is one request) and never optimistic: the row goes when the list that is asked for again no longer holds it, and the removal is
 * under way (`pendingId`) until then, so the outcome is told when the rows on screen are the new ones. A `404` (the entry is gone
 * already) is an outcome of its own and asks for the list again too; any other failure is `failure`, for the screen to show, and leaves
 * the list as it is.
 */
export function useRemoveEntry({ installationId, onOutcome }: RemoveEntryInput) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: allowlistKey(installationId) });
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (entryId: number) => client.call(removeEntryRoute, { params: { installationId, entryId } }),
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
    remove: (entry: Entry) => {
      send(entry.id);
    },
    pendingId: mutation.isPending ? mutation.variables : undefined,
    failure: mutation.isError && !isGone(mutation.error) ? mutation.error : undefined,
  };
}
