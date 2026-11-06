// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ErrorState } from '../states/ErrorState.tsx';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import type { EditorState } from './editor-state.ts';
import { NoticeText } from './NoticeText.tsx';
import { ReloadBanner } from './ReloadBanner.tsx';
import type { useDraftActions } from './use-draft-actions.ts';

export interface EditorNoticesProps {
  readonly state: EditorState;
  readonly actions: ReturnType<typeof useDraftActions>;
}

/**
 * What the editor tells the person about the draft and the version (E18-S05), above the text: the status region (saved,
 * discarded, loaded, published) which is in the page before its text changes, the two banners of a change another admin made
 * ("Load latest" brings it in, and only then does the text on screen change), and the failures of a discard or a "Load latest".
 * The failure of a save is shown under the text, or as the conflict banner.
 */
export function EditorNotices({ state, actions }: EditorNoticesProps) {
  const { notice } = state;
  const loading = actions.reload.isPending ? actions.reload.variables : undefined;
  const banners = [state.conflict ? 'draft' : undefined, state.stale ? 'active' : undefined] as const;
  return (
    <div className="flex flex-col gap-3">
      <StatusMessage tone={notice === undefined ? 'neutral' : 'success'}>
        {notice === undefined ? null : <NoticeText notice={notice} />}
      </StatusMessage>
      {banners.map((kind) =>
        kind === undefined ? null : (
          <ReloadBanner
            key={kind}
            kind={kind}
            pending={loading === kind}
            onReload={() => {
              actions.reload.mutate(kind);
            }}
          />
        ),
      )}
      {actions.discard.isError ? <ErrorState variant="banner" error={actions.discard.error} /> : null}
      {actions.reload.isError ? <ErrorState variant="banner" error={actions.reload.error} /> : null}
    </div>
  );
}
