// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';

export interface NoPendingPrsProps {
  /** Whether a repository or a reason narrows the list: "nothing matches" is not "everything is covered". */
  readonly filtered: boolean;
}

/** The empty state of the pending list (E18-S08): every open pull request is covered or exempt, or none matches the filters. */
export function NoPendingPrs({ filtered }: NoPendingPrsProps) {
  const t = useT();
  return (
    <EmptyState
      level={3}
      title={t('pending.empty.title')}
      description={t(filtered ? 'pending.empty.filtered' : 'pending.empty.none')}
    />
  );
}
