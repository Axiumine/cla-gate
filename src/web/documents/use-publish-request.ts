// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Dispatch, useState } from 'react';
import { publishVersionRoute } from '../../shared/cla-routes.ts';
import { useApiClient } from '../auth/hooks.ts';
import { type DocumentIds, documentListKey } from './document-queries.ts';
import { affectedSignaturesOf, isRule } from './document-rules.ts';
import type { EditorAction, Published } from './editor-state.ts';
import { versionsKey } from './history/history-queries.ts';
import type { PublishBody } from './publish-body.ts';
import { useSingleFlight } from './use-single-flight.ts';

/** What a screen does with the answers of a publish that are not its own business: the version, and the two moves another admin can make first. */
export interface PublishOutcomes {
  /** The version was made. */
  readonly published: (published: Published) => void;
  /** Another admin published a version first (`409 stale_active_version`). */
  readonly stale: () => void;
  /** The draft moved on (`409 draft_conflict`). */
  readonly conflict: () => void;
}

/** The outcomes of the publish dialog of the editor (E18-S05): each one goes to the reducer of the editor, which closes the dialog and says what happened. */
export function editorOutcomes(dispatch: Dispatch<EditorAction>): PublishOutcomes {
  return {
    published: (published) => {
      dispatch({ type: 'published', published });
    },
    stale: () => {
      dispatch({ type: 'stale' });
    },
    conflict: () => {
      dispatch({ type: 'conflict' });
    },
  };
}

/**
 * The publish request of E18-S05 and E18-S11, sent once at a time. A version another admin published first (`stale_active_version`)
 * and a draft that moved (`draft_conflict`) go to `outcomes`, which say so; a `409 resign_confirmation_required` keeps the number of
 * contributors who must sign again, for the dialog to ask about; a publish makes the list of documents and the history out of date
 * and goes to `outcomes`.
 */
export function usePublishRequest(ids: DocumentIds, outcomes: PublishOutcomes) {
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
      void queryClient.invalidateQueries({ queryKey: versionsKey(ids) });
      outcomes.published(published);
    },
    onError: (error) => {
      if (isRule(error, 'stale_active_version')) {
        outcomes.stale();
      } else if (isRule(error, 'draft_conflict')) {
        outcomes.conflict();
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
