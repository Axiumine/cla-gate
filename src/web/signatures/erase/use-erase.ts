// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { erasuresRoute } from '../../../shared/erasure-routes.ts';
import { useApiClient } from '../../auth/hooks.ts';
import { useSingleFlight } from '../../documents/use-single-flight.ts';
import { signaturesKey } from '../signature-queries.ts';
import { erasurePreviewKey } from './erase-queries.ts';
import { isCountChanged, isNothingHeld } from './erase-rules.ts';

export interface ErasureInput {
  /** `installations.id` of the tenant in the address: the erasure is addressed through it. */
  readonly installationId: number;
  /** The person, by numeric GitHub id. */
  readonly githubUserId: number;
  /** Told how many rows of personal data were erased, once the list has been asked for again. */
  readonly onDone: (erasedRows: number) => void;
}

/**
 * The erasure of one person's personal data (E18-S14): `POST .../installations/:installationId/erasures` with `{ githubUserId, expectedRows }`,
 * sent once at a time (a double click is one request) and never optimistic: the signatures are asked for again and `onDone` is told how many
 * rows were erased when the rows on screen are the new ones, where the signer reads "Erased". `409 count_changed` asks for the preview again,
 * so the question shows the new numbers, and is `countChanged` until the person confirms again; `404` (the installation holds nothing of the
 * person) is `nothingHeld`; any other failure (a `403`, the database) is `failure`. The question shows each of them and a new attempt clears them.
 */
export function useErase({ installationId, githubUserId, onDone }: ErasureInput) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (expectedRows: number) =>
      client.call(erasuresRoute, { params: { installationId }, body: { githubUserId, expectedRows } }),
    onSuccess: async ({ erasedRows }) => {
      await queryClient.invalidateQueries({ queryKey: signaturesKey(installationId) });
      onDone(erasedRows);
    },
    onError: async (error) => {
      if (isCountChanged(error)) {
        await queryClient.invalidateQueries({ queryKey: erasurePreviewKey(installationId, githubUserId) });
      }
    },
  });
  const send = useSingleFlight(mutation);
  const countChanged = mutation.isError && isCountChanged(mutation.error);
  const nothingHeld = mutation.isError && isNothingHeld(mutation.error);
  return {
    send,
    pending: mutation.isPending,
    countChanged,
    nothingHeld,
    failure: mutation.isError && !countChanged && !nothingHeld ? mutation.error : undefined,
    reset: mutation.reset,
  };
}
