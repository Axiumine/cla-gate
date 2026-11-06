// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { RepositoryPage } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { StatusMessage } from '../ui/index.ts';
import { visibleText } from '../ui/user-text.ts';
import type { RepositoryOutcome } from './use-repository-change.ts';

export interface ResultStatusProps {
  /** The page on screen, once there is one. */
  readonly shown: RepositoryPage | undefined;
  /** What the last change did, if there was one. */
  readonly notice: RepositoryOutcome | undefined;
}

/**
 * What the results say in words (E18-S10), each in a polite live region that is in the page before its text changes: how many repositories
 * the page holds (announced after each search), and what the last change did. A change that asked for what already was, and a
 * repository that is gone, are information and not an error. The repository is text a person controls and goes through `visibleText`.
 */
export function ResultStatus({ shown, notice }: ResultStatusProps) {
  const t = useT();
  const informative = notice?.kind === 'unchanged' || notice?.kind === 'gone';
  return (
    <>
      <StatusMessage>{shown === undefined ? null : t.plural('repositories.count', shown.items.length)}</StatusMessage>
      <StatusMessage tone={informative ? 'info' : 'success'}>
        {notice === undefined
          ? null
          : t(`repositories.notice.${notice.kind}`, { repository: visibleText(notice.repository) })}
      </StatusMessage>
    </>
  );
}
