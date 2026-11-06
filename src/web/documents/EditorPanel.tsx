// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Dispatch } from 'react';
import { useFormatters, useT } from '../i18n/index.ts';
import { useInstallation } from '../installations/use-installations.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import type { DocumentIds } from './document-queries.ts';
import { isContentRule, isShownByEditor, ruleMessage } from './document-rules.ts';
import { EditorButtons } from './EditorButtons.tsx';
import { EditorNotices } from './EditorNotices.tsx';
import { EditorPreview } from './EditorPreview.tsx';
import { EditorText } from './EditorText.tsx';
import type { EditorAction, EditorState } from './editor-state.ts';
import { PublishDialog } from './PublishDialog.tsx';
import type { useDraftActions } from './use-draft-actions.ts';

export interface EditorPanelProps {
  readonly ids: DocumentIds;
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
  readonly actions: ReturnType<typeof useDraftActions>;
}

/**
 * The editor tab (E18-S05): the notices, the text next to its live preview, the failure of a save, the actions, and the publish
 * dialog. A rule that a save broke about the text is shown under the text; the conflict has its banner; any other failure (a `403`
 * included) is the error state under the text, and in every case the text on screen is untouched. Editing the text clears the
 * failure of the last save, which was about the text that was sent.
 */
export function EditorPanel({ ids, state, dispatch, actions }: EditorPanelProps) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const readOnly = useInstallation(ids.installationId)?.suspended === true;
  const saveError = actions.save.isError ? actions.save.error : undefined;
  return (
    <div className="flex flex-col gap-4">
      <EditorNotices state={state} actions={actions} />
      <div className="grid gap-6 lg:grid-cols-2">
        <EditorText
          text={state.text}
          readOnly={readOnly}
          error={isContentRule(saveError) ? ruleMessage({ t, formatNumber }, saveError) : undefined}
          onChange={(text) => {
            if (actions.save.isError) {
              actions.save.reset();
            }
            dispatch({ type: 'edit', text });
          }}
        />
        <EditorPreview text={state.text} />
      </div>
      {saveError === undefined || isShownByEditor(saveError) ? null : <ErrorState variant="banner" error={saveError} />}
      <EditorButtons state={state} dispatch={dispatch} actions={actions} readOnly={readOnly} />
      <PublishDialog ids={ids} state={state} dispatch={dispatch} actions={actions} />
    </div>
  );
}
