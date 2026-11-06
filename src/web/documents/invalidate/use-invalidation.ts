// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidationsRoute } from '../../../shared/signature-invalidate-routes.ts';
import { useApiClient } from '../../auth/hooks.ts';
import { signaturesKey } from '../../signatures/signature-queries.ts';
import type { RevokeReason } from '../../signatures/use-revoke-signature.ts';
import type { DocumentIds } from '../document-queries.ts';
import { isRule } from '../document-rules.ts';
import { versionsKey } from '../history/history-queries.ts';
import { useSingleFlight } from '../use-single-flight.ts';
import { invalidationPreviewKey } from './invalidate-queries.ts';

/** What the person decided: why, and the number of signatures they saw. */
export interface InvalidationChoice {
  readonly reasonCode: RevokeReason;
  readonly expectedCount: number;
}

export interface InvalidationInput {
  readonly ids: DocumentIds;
  /** The major whose signatures are taken out of force. */
  readonly major: number;
  /** Told how many signatures were invalidated, once the lists have been asked for again. */
  readonly onDone: (invalidated: number) => void;
  /** Told that the count moved, once the preview has been asked for again: what the person confirmed is no longer what is true. */
  readonly onCountChanged: () => void;
}

/**
 * The invalidation of one major (E18-S14): `POST .../documents/:documentId/invalidations` with `{ major, reasonCode, expectedCount }`,
 * sent once at a time (a double click is one request) and never optimistic: the signatures and the versions are asked for again and
 * `onDone` is told how many were invalidated when the rows on screen are the new ones. `409 count_changed` asks for the preview again, so
 * the question shows the new number, and is `countChanged` until the person confirms again; `409 nothing_to_invalidate` (everything
 * was invalidated meanwhile) is `nothing`; any other failure (a `403`, a `404`, GitHub or the queue down) is `failure`. The question shows
 * each of them and a new attempt clears them.
 */
export function useInvalidation({ ids, major, onDone, onCountChanged }: InvalidationInput) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: ({ reasonCode, expectedCount }: InvalidationChoice) =>
      client.call(invalidationsRoute, {
        params: { installationId: ids.installationId, documentId: ids.documentId },
        body: { major, reasonCode, expectedCount },
      }),
    onSuccess: async ({ invalidated }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: signaturesKey(ids.installationId) }),
        queryClient.invalidateQueries({ queryKey: versionsKey(ids) }),
      ]);
      onDone(invalidated);
    },
    onError: async (error) => {
      if (isRule(error, 'count_changed')) {
        await queryClient.invalidateQueries({ queryKey: invalidationPreviewKey(ids, major) });
        onCountChanged();
      }
    },
  });
  const send = useSingleFlight(mutation);
  const countChanged = mutation.isError && isRule(mutation.error, 'count_changed');
  const nothing = mutation.isError && isRule(mutation.error, 'nothing_to_invalidate');
  return {
    send,
    pending: mutation.isPending,
    countChanged,
    nothing,
    failure: mutation.isError && !countChanged && !nothing ? mutation.error : undefined,
    reset: mutation.reset,
  };
}
