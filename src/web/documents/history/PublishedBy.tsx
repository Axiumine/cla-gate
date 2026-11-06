// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { UserText } from '../../ui/index.ts';
import type { VersionSummary } from './history-queries.ts';

export interface PublishedByProps {
  readonly by: VersionSummary['publishedBy'];
}

/**
 * Who published a version (E18-S11): the login as a snapshot through `UserText`, and the numeric GitHub id in `<code>`, which is the
 * identity (a login can change, and reads `erased-<id>` once the person is erased). The id is a number this code formats, so it is
 * text, and a screen reader is told what the number is.
 */
export function PublishedBy({ by }: PublishedByProps) {
  const t = useT();
  return (
    <span>
      <UserText>{by.login}</UserText>{' '}
      <span className="text-fg-muted">
        <span className="sr-only">{t('history.publishedBy.id')} </span>
        <code className="font-mono text-xs">{by.githubId}</code>
      </span>
    </span>
  );
}
