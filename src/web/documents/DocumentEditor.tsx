// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useReducer } from 'react';
import { useT } from '../i18n/index.ts';
import { Heading, Tabs } from '../ui/index.ts';
import { UserText } from '../ui/UserText.tsx';
import { DocumentFacts } from './DocumentFacts.tsx';
import type { DocumentIds, EditorSeed } from './document-queries.ts';
import { EditorPanel } from './EditorPanel.tsx';
import { editorReducer, initialEditorState, isDirty } from './editor-state.ts';
import { LeaveDialog } from './LeaveDialog.tsx';
import { useDraftActions } from './use-draft-actions.ts';
import { useLeaveGuard } from './use-leave-guard.ts';

export interface DocumentEditorProps {
  readonly ids: DocumentIds;
  /** What the server said when the editor was opened: the state starts from it, and a change of it later is the person's to load. */
  readonly seed: EditorSeed;
}

/**
 * One document with its editor (E18-S05). The state of the editor is held here, above the tabs, so it stays when the person looks
 * at another tab (the history, E18-S11). Work that is not saved holds the navigation: the router asks first, and the browser asks
 * when the page is reloaded or closed. The name of the document is text a person controls and goes through `UserText`.
 */
export function DocumentEditor({ ids, seed }: DocumentEditorProps) {
  const t = useT();
  const [state, dispatch] = useReducer(editorReducer, seed, initialEditorState);
  const actions = useDraftActions(ids, state, dispatch);
  const guard = useLeaveGuard(isDirty(state));
  return (
    <div className="flex flex-col gap-6">
      <Heading level={1}>
        <UserText>{seed.document.name}</UserText>
      </Heading>
      <DocumentFacts document={seed.document} active={state.active} hasDraft={state.saved.revision !== null} />
      <Tabs
        label={t('document.tabs.label')}
        items={[
          {
            value: 'editor',
            label: t('document.tabs.editor'),
            panel: <EditorPanel ids={ids} state={state} dispatch={dispatch} actions={actions} />,
          },
        ]}
      />
      <LeaveDialog guard={guard} />
    </div>
  );
}
