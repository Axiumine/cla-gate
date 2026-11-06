// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactElement } from 'react';
import { useT } from '../i18n/index.ts';
import { UserText } from '../ui/index.ts';
import type { PendingPr, PendingReason } from './pending-queries.ts';
import { type RecordActions, RecordOverride } from './RecordOverride.tsx';

/** What a reason says about who or what it concerns: the commit, or the account (its login, or its id while no login is known). */
function ReasonDetail({ reason }: { readonly reason: PendingReason }): ReactElement | null {
  const t = useT();
  if (reason.commitSha !== undefined) {
    return <code className="break-all">{reason.commitSha}</code>;
  }
  if (reason.githubId === undefined) {
    return null;
  }
  return typeof reason.login === 'string' ? (
    <UserText>{reason.login}</UserText>
  ) : (
    <span>{t('pending.account.unseen', { id: reason.githubId })}</span>
  );
}

/** One reason a pull request is blocked, in the words of the catalog for its code, with the account or the commit it names. */
function ReasonText({ reason }: { readonly reason: PendingReason }) {
  const t = useT();
  const detail = <ReasonDetail reason={reason} />;
  return (
    <span>
      {t(`pending.reason.${reason.code}`)} {detail}
    </span>
  );
}

export interface ReasonListProps {
  readonly item: PendingPr;
  readonly actions: RecordActions;
}

/**
 * The reasons a pull request is blocked (E18-S08), one line each. A reason of an unlinked identity carries "Record override" for its
 * commit in the repository of the pull request; the others carry nothing, because the way out of them is a signature, the allowlist or
 * the configuration, which other screens own.
 */
export function ReasonList({ item, actions }: ReasonListProps) {
  return (
    <ul className="flex flex-col gap-2">
      {item.reasons.map((reason) => (
        <li
          key={[reason.code, reason.githubId, reason.commitSha].join(':')}
          className="flex flex-wrap items-center gap-2"
        >
          <ReasonText reason={reason} />
          {reason.code === 'unlinked_identity' && reason.commitSha !== undefined ? (
            <RecordOverride actions={actions} repository={item.repository} commitSha={reason.commitSha} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
