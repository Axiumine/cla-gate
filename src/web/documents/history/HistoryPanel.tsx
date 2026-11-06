// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Dispatch, useRef } from 'react';
import type { DocumentIds } from '../document-queries.ts';
import type { EditorAction, EditorState } from '../editor-state.ts';
import type { useDraftActions } from '../use-draft-actions.ts';
import { HistoryDetail } from './HistoryDetail.tsx';
import { HistoryIntro } from './HistoryIntro.tsx';
import { HistoryList } from './HistoryList.tsx';
import { HistoryNotices } from './HistoryNotices.tsx';
import { type DocumentSearch, type OnSearch, panelOf, toCursor, toList, toVersion } from './history-search.ts';

export interface HistoryPanelProps {
  readonly ids: DocumentIds;
  readonly search: DocumentSearch;
  readonly state: EditorState;
  readonly dispatch: Dispatch<EditorAction>;
  readonly reload: ReturnType<typeof useDraftActions>['reload'];
  readonly onSearch: OnSearch;
}

/**
 * The "History" tab of a document (E18-S11), read-only: the versions newest first, and under them the text of one version or the
 * comparison of two, whichever the address names. Nothing on a version edits or deletes it: a mistake is fixed by publishing a new
 * version, which "Restore this text" in the viewer does for an old text. Opening a panel moves focus to its heading, and closing one
 * moves it to the heading of the list, so a keyboard user is never left on a control that is gone.
 */
export function HistoryPanel({ ids, search, state, dispatch, reload, onSearch }: HistoryPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = panelOf(search);
  const close = () => {
    onSearch(toList);
    heading.current?.focus();
  };
  return (
    <div className="flex flex-col gap-6">
      <HistoryNotices state={state} reload={reload} />
      <HistoryIntro headingRef={heading} comparing={panel.type === 'compare'} onSearch={onSearch} />
      <HistoryList
        ids={ids}
        cursor={search.cursor}
        onCursorChange={(cursor) => {
          onSearch(toCursor(cursor));
        }}
        onFirstPage={() => {
          onSearch(toCursor(undefined), true);
        }}
        onView={(versionId) => {
          onSearch(toVersion(versionId));
        }}
      />
      <HistoryDetail
        ids={ids}
        panel={panel}
        active={state.active}
        dispatch={dispatch}
        onSearch={onSearch}
        onClose={close}
      />
    </div>
  );
}
