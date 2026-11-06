// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ErrorState } from '../../states/ErrorState.tsx';
import { StatusMessage } from '../../ui/StatusMessage.tsx';
import type { EditorState } from '../editor-state.ts';
import { NoticeText } from '../NoticeText.tsx';
import { ReloadBanner } from '../ReloadBanner.tsx';
import type { useDraftActions } from '../use-draft-actions.ts';

export interface HistoryNoticesProps {
  readonly state: EditorState;
  readonly reload: ReturnType<typeof useDraftActions>['reload'];
}

/**
 * What the history tells the person about the versions (E18-S11), above the list: the status region says that a version was published
 * (a restore) or that the latest version is loaded; the banner says that another admin published a version while the person worked
 * (`409 stale_active_version`), with "Load latest", which brings the new version in and makes the list out of date; and a failed "Load
 * latest" is the error banner. The notices about the draft belong to the editor and are not repeated here. The editor holds the state
 * above its tabs, so a notice made here is there when the person goes back to the editor.
 */
export function HistoryNotices({ state, reload }: HistoryNoticesProps) {
  const { notice } = state;
  const shown = notice?.type === 'published' || notice?.type === 'loadedActive' ? notice : undefined;
  return (
    <div className="flex flex-col gap-3">
      <StatusMessage tone={shown === undefined ? 'neutral' : 'success'}>
        {shown === undefined ? null : <NoticeText notice={shown} />}
      </StatusMessage>
      {state.stale ? (
        <ReloadBanner
          kind="active"
          pending={reload.isPending}
          onReload={() => {
            reload.mutate('active');
          }}
        />
      ) : null}
      {reload.isError ? <ErrorState variant="banner" error={reload.error} /> : null}
    </div>
  );
}
