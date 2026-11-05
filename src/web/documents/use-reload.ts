// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation } from '@tanstack/react-query';
import type { Dispatch } from 'react';
import { useApiClient } from '../auth/hooks.ts';
import { type DocumentIds, type EditorSeed, readEditorSeed } from './document-queries.ts';
import type { EditorAction } from './editor-state.ts';

/** Which part of the latest state a "Load latest" brings in: the draft another admin saved, or the version another admin published. */
export type ReloadKind = 'draft' | 'active';

/**
 * "Load latest" (E18-S05): reads the document, its draft and the text of its active version again, and brings in the part that
 * `kind` names, only when the person asks. Nothing is kept of the answer beyond the editor's own state (`gcTime: 0`).
 */
export function useReload(ids: DocumentIds, dispatch: Dispatch<EditorAction>) {
  const client = useApiClient();
  return useMutation<EditorSeed, Error, ReloadKind>({
    gcTime: 0,
    mutationFn: () => readEditorSeed(client, ids),
    onSuccess: (seed, kind) => {
      dispatch(
        kind === 'draft'
          ? { type: 'loadedDraft', draft: seed.draft }
          : { type: 'loadedActive', active: seed.document.activeVersion, activeText: seed.activeText },
      );
    },
  });
}
