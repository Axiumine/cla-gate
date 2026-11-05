// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import { AlertDialog, Button, UserText } from '../ui/index.ts';
import { visibleText } from '../ui/user-text.ts';
import type { Entry } from './allowlist-queries.ts';

export interface RemoveEntryProps {
  readonly entry: Entry;
  /** This entry's removal is under way: the button is busy. */
  readonly pending: boolean;
  /** The installation is suspended, or another removal is under way: nothing here writes. */
  readonly disabled: boolean;
  /** Runs when the person confirms. The dialog closes and the screen keeps the outcome. */
  readonly onRemove: (entry: Entry) => void;
}

/**
 * "Remove" on one row (E18-S06): an `AlertDialog` that names the entry through `UserText`, says what stops being exempt and who made the
 * entry, and removes it only when the person confirms. Cancel is where focus starts, Escape does nothing, and focus returns to the row's
 * button when the person cancels. The name of the button holds the account, so the buttons of a list are told apart.
 */
export function RemoveEntry({ entry, pending, disabled, onRemove }: RemoveEntryProps) {
  const t = useT();
  const subject = entry.loginSnapshot ?? t('allowlist.subject.unknownLogin');
  return (
    <AlertDialog
      title={
        <>
          {t('allowlist.remove.title')} <UserText>{subject}</UserText>
        </>
      }
      description={t(`allowlist.remove.description.${entry.kind === 'org_members' ? 'orgMembers' : 'account'}`)}
      confirmLabel={t('allowlist.remove.confirm')}
      destructive
      onConfirm={() => {
        onRemove(entry);
      }}
      trigger={
        <Button
          variant="secondary"
          loading={pending}
          disabled={disabled}
          aria-label={t('allowlist.remove.label', { account: visibleText(subject) })}
        >
          {t('allowlist.remove')}
        </Button>
      }
    >
      <p className="text-sm">
        {t('allowlist.remove.addedBy')} <UserText>{entry.createdBy.login}</UserText>
        {', '}
        <Timestamp value={entry.createdAt} utc />
      </p>
    </AlertDialog>
  );
}
