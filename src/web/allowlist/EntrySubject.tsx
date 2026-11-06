// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { UserText } from '../ui/index.ts';
import type { Entry } from './allowlist-queries.ts';

export interface EntrySubjectProps {
  readonly entry: Entry;
}

/**
 * The account an entry exempts (E18-S06): the login snapshot, which is what GitHub called the account when the entry was made and can be
 * out of date after a rename, and the numeric GitHub id in `<code>`, which is the identity and the only thing matching reads. An entry
 * with no snapshot (after an erasure) says so. For `org_members` the account is the organisation, and the kind column says so.
 */
export function EntrySubject({ entry }: EntrySubjectProps) {
  const t = useT();
  return (
    <span>
      {entry.loginSnapshot === null ? (
        <span className="text-fg-muted">{t('allowlist.subject.unknownLogin')}</span>
      ) : (
        <UserText>{entry.loginSnapshot}</UserText>
      )}{' '}
      <code>{entry.githubId}</code>
    </span>
  );
}
