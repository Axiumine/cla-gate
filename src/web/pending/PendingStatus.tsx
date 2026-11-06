// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { StatusMessage } from '../ui/index.ts';
import type { PendingPrsPage } from './pending-queries.ts';

export interface PendingStatusProps {
  /** The page on screen, once there is one. */
  readonly shown: PendingPrsPage | undefined;
  /** An override was recorded from this list. */
  readonly recorded: boolean;
}

/**
 * What the pending list says in words (E18-S08), each in a polite live region that is in the page before its text changes: how many
 * pull requests the page holds, that an override was recorded, and that the list of a repository admin was cut short.
 */
export function PendingStatus({ shown, recorded }: PendingStatusProps) {
  const t = useT();
  const truncated = shown?.truncated === true;
  return (
    <>
      <StatusMessage>{shown === undefined ? null : t.plural('pending.count', shown.items.length)}</StatusMessage>
      <StatusMessage tone={recorded ? 'success' : 'neutral'}>
        {recorded ? t('pending.notice.recorded') : null}
      </StatusMessage>
      <StatusMessage tone={truncated ? 'warning' : 'neutral'}>
        {truncated ? t('pending.truncated') : null}
      </StatusMessage>
    </>
  );
}
