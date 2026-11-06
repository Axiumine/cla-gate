// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Dispatch } from 'react';
import { useT } from '../i18n/index.ts';
import { Dialog } from '../ui/index.ts';
import type { DocumentIds } from './document-queries.ts';
import type { EditorAction, EditorState } from './editor-state.ts';
import { isDirty } from './editor-state.ts';
import { PublishForm } from './PublishForm.tsx';
import { SaveFirst } from './SaveFirst.tsx';
import type { useDraftActions } from './use-draft-actions.ts';
import { editorOutcomes } from './use-publish-request.ts';

export interface PublishDialogProps {
  readonly ids: DocumentIds;
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
  readonly actions: ReturnType<typeof useDraftActions>;
}

/**
 * The publish dialog (E18-S05), open while `state.publishing`. A version is made from the saved draft, so the form is there only
 * when the text on screen equals the saved draft; otherwise the dialog asks to save first. The editor closes it when a conflict,
 * a newer version or a publish needs the person to look at the editor.
 */
export function PublishDialog({ ids, state, dispatch, actions }: PublishDialogProps) {
  const t = useT();
  const revision = state.saved.revision;
  return (
    <Dialog
      open={state.publishing}
      onOpenChange={(open) => {
        dispatch({ type: 'publishing', open });
      }}
      title={t('publish.title')}
      description={t('publish.description')}
    >
      {revision !== null && !isDirty(state) ? (
        <PublishForm
          ids={ids}
          target={{ from: { type: 'draft', revision }, active: state.active }}
          text={state.saved.text}
          outcomes={editorOutcomes(dispatch)}
        />
      ) : (
        <SaveFirst
          saving={actions.save.isPending}
          error={actions.save.isError ? actions.save.error : undefined}
          onSave={actions.saveDraft}
        />
      )}
    </Dialog>
  );
}
