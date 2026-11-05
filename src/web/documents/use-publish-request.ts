// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Dispatch, useState } from 'react';
import { publishVersionRoute } from '../../shared/cla-routes.ts';
import { useApiClient } from '../auth/hooks.ts';
import { type DocumentIds, documentListKey } from './document-queries.ts';
import { affectedSignaturesOf, isRule } from './document-rules.ts';
import type { EditorAction } from './editor-state.ts';
import type { PublishBody } from './publish-body.ts';
import { useSingleFlight } from './use-single-flight.ts';

/**
 * The publish request of E18-S05, sent once at a time. A version another admin published first (`stale_active_version`) and a
 * draft that moved (`draft_conflict`) go to the editor, which closes the dialog and says so; a `409 resign_confirmation_required`
 * keeps the number of contributors who must sign again, for the dialog to ask about; a publish refreshes the list and goes to the editor.
 */
export function usePublishRequest(ids: DocumentIds, dispatch: Dispatch<EditorAction>) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [affected, setAffected] = useState<number | undefined>(undefined);
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (body: PublishBody) =>
      client.call(publishVersionRoute, {
        params: { installationId: ids.installationId, documentId: ids.documentId },
        body,
      }),
    onSuccess: (published) => {
      void queryClient.invalidateQueries({ queryKey: documentListKey(ids.installationId) });
      dispatch({ type: 'published', published });
    },
    onError: (error) => {
      if (isRule(error, 'stale_active_version')) {
        dispatch({ type: 'stale' });
      } else if (isRule(error, 'draft_conflict')) {
        dispatch({ type: 'conflict' });
      } else {
        const count = affectedSignaturesOf(error);
        if (count !== undefined) {
          setAffected(count);
        }
      }
    },
  });
  return { send: useSingleFlight(mutation), mutation, affected };
}
