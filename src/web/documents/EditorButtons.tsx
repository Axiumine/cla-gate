// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Dispatch } from 'react';
import { useT } from '../i18n/index.ts';
import { AlertDialog, Button } from '../ui/index.ts';
import { type EditorAction, type EditorState, isDirty } from './editor-state.ts';
import type { useDraftActions } from './use-draft-actions.ts';

export interface EditorButtonsProps {
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
  readonly actions: ReturnType<typeof useDraftActions>;
  /** The installation is suspended: nothing here writes. */
  readonly readOnly: boolean;
}

/**
 * The three actions of the editor (E18-S05). "Save draft" is explicit and never automatic; it is off while there is nothing to
 * save (a draft is saved and the text is that draft). "Discard draft" is there while a draft is saved and asks first, in an
 * `AlertDialog`, because it deletes the draft for every admin of the document. "Publish" opens the publish dialog.
 */
export function EditorButtons({ state, dispatch, actions, readOnly }: EditorButtonsProps) {
  const t = useT();
  const hasDraft = state.saved.revision !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        loading={actions.save.isPending}
        disabled={readOnly || (hasDraft && !isDirty(state))}
        onClick={actions.saveDraft}
      >
        {t('editor.save')}
      </Button>
      {hasDraft ? (
        <AlertDialog
          title={t('editor.discard.title')}
          description={t('editor.discard.description')}
          confirmLabel={t('editor.discard.confirm')}
          destructive
          onConfirm={() => {
            actions.discard.mutate();
          }}
          trigger={
            <Button variant="secondary" loading={actions.discard.isPending} disabled={readOnly}>
              {t('editor.discard')}
            </Button>
          }
        />
      ) : null}
      <Button
        variant="secondary"
        disabled={readOnly}
        onClick={() => {
          dispatch({ type: 'publishing', open: true });
        }}
      >
        {t('editor.publish')}
      </Button>
    </div>
  );
}
