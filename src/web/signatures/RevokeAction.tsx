// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { AlertDialog, Button, UserText } from '../ui/index.ts';
import { visibleText } from '../ui/user-text.ts';
import { RevokeReasonField } from './RevokeReasonField.tsx';
import type { Signature } from './signature-queries.ts';
import { signerSubject } from './signer-subject.ts';
import { useRevokeDialog } from './use-revoke-dialog.ts';
import type { RevokeOutcome } from './use-revoke-signature.ts';

export interface RevokeActionProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  readonly item: Signature;
  /** The installation is suspended: nothing here writes. */
  readonly suspended: boolean;
  /** Told how the revocation ended, once the list has been asked for again. */
  readonly onOutcome: (outcome: RevokeOutcome) => void;
  /** The row is gone from the list after a revocation (the list is filtered by a state it no longer has): the screen puts focus somewhere. */
  readonly onVanished: () => void;
}

/**
 * "Revoke" on one row (E18-S07): an `AlertDialog` that names the signer through `UserText`, says that revocation applies to future
 * pull requests only, and asks for the reason, which is required. The dialog stays open while the request is out and when it fails
 * (a `403`, a `404`, GitHub down are shown in it), and closes when the list says the signature is revoked or that it was already.
 * Focus starts on Cancel, Escape does nothing, and focus returns to the row's button, which stays on a revoked row but is only marked
 * unavailable (`aria-disabled`), because a button that is really disabled cannot hold focus.
 */
export function RevokeAction({ installationId, item, suspended, onOutcome, onVanished }: RevokeActionProps) {
  const t = useT();
  const revoked = item.state === 'revoked';
  const dialog = useRevokeDialog({ installationId, signatureId: item.id, revoked, onOutcome, onVanished });
  const subject = signerSubject(item, t);
  return (
    <AlertDialog
      open={dialog.open}
      onOpenChange={dialog.onOpenChange}
      title={
        <>
          {t('signatures.revoke.title')} <UserText>{subject}</UserText>
        </>
      }
      description={t('signatures.revoke.description')}
      confirmLabel={t('signatures.revoke.confirm')}
      destructive
      confirming={dialog.pending}
      onConfirm={dialog.confirm}
      trigger={
        <Button
          variant="secondary"
          disabled={suspended}
          aria-disabled={revoked ? true : undefined}
          aria-label={t('signatures.revoke.label', { signer: visibleText(subject) })}
          className={revoked ? 'cursor-not-allowed opacity-60' : undefined}
        >
          {t('signatures.revoke')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <RevokeReasonField value={dialog.reason} onChange={dialog.choose} missing={dialog.missing} />
        {dialog.failure === undefined ? null : <ErrorState variant="banner" error={dialog.failure} />}
      </div>
    </AlertDialog>
  );
}
