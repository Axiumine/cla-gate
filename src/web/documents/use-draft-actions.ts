// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Dispatch } from 'react';
import { discardDraftRoute, saveDraftRoute } from '../../shared/cla-routes.ts';
import { useApiClient } from '../auth/hooks.ts';
import { type DocumentIds, documentListKey } from './document-queries.ts';
import { isRule } from './document-rules.ts';
import type { EditorAction, EditorState } from './editor-state.ts';
import { useReload } from './use-reload.ts';
import { useSingleFlight } from './use-single-flight.ts';

/**
 * The requests the editor makes besides the publish (E18-S05): save the draft, discard it, and read the latest state again.
 * Nothing is automatic and nothing is optimistic: each request is sent when the person asks, the editor changes when the server
 * has answered, and the text of the request is kept no longer than the editor is open (`gcTime: 0`). A save at a revision the
 * server has moved past (`409 draft_conflict`) keeps the local text and says so; the list of documents is made out of date by
 * a save or a discard, since it shows whether a draft is saved.
 */
export function useDraftActions(ids: DocumentIds, state: EditorState, dispatch: Dispatch<EditorAction>) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const params = { installationId: ids.installationId, documentId: ids.documentId };
  const listChanged = () => {
    void queryClient.invalidateQueries({ queryKey: documentListKey(ids.installationId) });
  };
  const save = useMutation({
    gcTime: 0,
    mutationFn: (request: { readonly text: string; readonly revision: number | null }) =>
      client.call(saveDraftRoute, { params, body: { contentMd: request.text, expectedRevision: request.revision } }),
    onSuccess: (response, request) => {
      dispatch({ type: 'saved', revision: response.draft.revision, text: request.text });
      listChanged();
    },
    onError: (error) => {
      if (isRule(error, 'draft_conflict')) {
        dispatch({ type: 'conflict' });
      }
    },
  });
  const discard = useMutation({
    gcTime: 0,
    mutationFn: () => client.call(discardDraftRoute, { params }),
    onSuccess: () => {
      dispatch({ type: 'discarded' });
      listChanged();
    },
  });
  const reload = useReload(ids, dispatch);
  const send = useSingleFlight(save);
  return {
    save,
    discard,
    reload,
    saveDraft: () => {
      send({ text: state.text, revision: state.saved.revision });
    },
  };
}
