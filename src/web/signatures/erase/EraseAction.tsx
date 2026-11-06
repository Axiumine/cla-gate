// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { AlertDialog, Button, UserText } from '../../ui/index.ts';
import { visibleText } from '../../ui/user-text.ts';
import type { Signature } from '../signature-queries.ts';
import { signerSubject } from '../signer-subject.ts';
import { EraseFailure } from './EraseFailure.tsx';
import { ErasePreview } from './ErasePreview.tsx';
import { useEraseDialog } from './use-erase-dialog.ts';

export interface EraseActionProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly item: Signature;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Told how many rows of personal data were erased, once the list has been asked for again. */
  readonly onDone: (erasedRows: number) => void;
}

/**
 * "Erase personal data" on one row (E18-S14), for an org admin: an `AlertDialog` that names the signer through `UserText`, shows what an
 * erasure removes and what stays, from the counts the server made when it opened, and sends `{ githubUserId, expectedRows }` only when the
 * person confirms. The dialog stays open while the request is out and when it fails, and closes when the list has been asked for again.
 * Focus starts on Cancel, Escape cancels (it does nothing while the request is out), and focus returns to the button of the row, which stays on an erased row but is only marked
 * unavailable (`aria-disabled`) and reads "Erased", because a button that is really disabled cannot hold focus.
 */
export function EraseAction({ installationId, item, suspended, onDone }: EraseActionProps) {
  const t = useT();
  const erased = item.signer === null;
  const dialog = useEraseDialog({ installationId, githubUserId: item.githubUserId, erased, onDone });
  const subject = signerSubject(item, t);
  return (
    <AlertDialog
      open={dialog.open}
      onOpenChange={dialog.onOpenChange}
      title={
        <>
          {t('erase.title')} <UserText>{subject}</UserText>
        </>
      }
      description={t('erase.description')}
      confirmLabel={t('erase.confirm')}
      destructive
      escapeCancels
      confirming={dialog.pending}
      confirmDisabled={dialog.confirmDisabled}
      onConfirm={dialog.confirm}
      trigger={
        <Button
          variant="secondary"
          disabled={suspended}
          aria-disabled={erased ? true : undefined}
          aria-label={t(erased ? 'erase.erased.label' : 'erase.action.label', { signer: visibleText(subject) })}
          className={erased ? 'cursor-not-allowed opacity-60' : undefined}
        >
          {erased ? t('signatures.signer.erased') : t('erase.action')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <ErasePreview preview={dialog.preview} nothingHeld={dialog.nothingHeld} />
        <EraseFailure countChanged={dialog.countChanged} failure={dialog.failure} />
      </div>
    </AlertDialog>
  );
}
