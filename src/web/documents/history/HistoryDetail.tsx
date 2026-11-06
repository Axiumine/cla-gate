// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Dispatch } from 'react';
import type { DocumentIds } from '../document-queries.ts';
import type { ActiveVersion, EditorAction } from '../editor-state.ts';
import { type HistoryPanel, type OnSearch, toComparison } from './history-search.ts';
import { VersionCompare } from './VersionCompare.tsx';
import { VersionViewer } from './VersionViewer.tsx';

export interface HistoryDetailProps {
  readonly ids: DocumentIds;
  /** What the address opens under the list. */
  readonly panel: HistoryPanel;
  readonly active: ActiveVersion | null;
  readonly dispatch: Dispatch<EditorAction>;
  readonly onSearch: OnSearch;
  /** Closes the panel and puts focus on the heading of the list. */
  readonly onClose: () => void;
}

/** What lies under the list of versions (E18-S11): the text of one version, the comparison of two, or nothing. */
export function HistoryDetail({ ids, panel, active, dispatch, onSearch, onClose }: HistoryDetailProps) {
  if (panel.type === 'view') {
    return (
      <VersionViewer
        key={panel.versionId}
        ids={ids}
        versionId={panel.versionId}
        active={active}
        dispatch={dispatch}
        onClose={onClose}
      />
    );
  }
  return panel.type === 'compare' ? (
    <VersionCompare
      ids={ids}
      pair={panel.pair}
      onPairChange={(pair) => {
        onSearch(toComparison(pair), true);
      }}
      onClose={onClose}
    />
  ) : null;
}
