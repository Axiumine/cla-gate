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
import { HistoryPanel } from './history/HistoryPanel.tsx';
import type { OnSearch } from './history/history-search.ts';
import { type DocumentSearch, tabFromValue, tabOf, toTab } from './history/history-search.ts';
import { LeaveDialog } from './LeaveDialog.tsx';
import { useDraftActions } from './use-draft-actions.ts';
import { useLeaveGuard } from './use-leave-guard.ts';

export interface DocumentEditorProps {
  readonly ids: DocumentIds;
  /** What the server said when the editor was opened: the state starts from it, and a change of it later is the person's to load. */
  readonly seed: EditorSeed;
  /** What the address holds, once validated: the tab, and what the history shows. */
  readonly search: DocumentSearch;
  /** Changes the address. */
  readonly onSearch: OnSearch;
}

/**
 * One document with its editor and its history (E18-S05, E18-S11), in two tabs that the address names (`?tab=history`). The state of
 * the editor is held here, above the tabs, so it stays when the person looks at the history: switching tabs changes the search of the
 * address and not the page, so it does not trigger the question about unsaved work. Work that is not saved holds the navigation: the router asks first, and the browser asks
 * when the page is reloaded or closed. The name of the document is text a person controls and goes through `UserText`.
 */
export function DocumentEditor({ ids, seed, search, onSearch }: DocumentEditorProps) {
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
        value={tabOf(search)}
        onValueChange={(value) => {
          onSearch(toTab(tabFromValue(value)));
        }}
        items={[
          {
            value: 'editor',
            label: t('document.tabs.editor'),
            panel: <EditorPanel ids={ids} state={state} dispatch={dispatch} actions={actions} />,
          },
          {
            value: 'history',
            label: t('document.tabs.history'),
            panel: (
              <HistoryPanel
                ids={ids}
                search={search}
                state={state}
                dispatch={dispatch}
                reload={actions.reload}
                onSearch={onSearch}
              />
            ),
          },
        ]}
      />
      <LeaveDialog guard={guard} />
    </div>
  );
}
