// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useRef, useState } from 'react';
import { useVanished } from '../ui/use-vanished.ts';
import { type RevokeOutcome, type RevokeReason, useRevokeSignature } from './use-revoke-signature.ts';

export interface RevokeDialogInput {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** `signatures.id` of the row. */
  readonly signatureId: number;
  /** The signature is revoked already: the dialog does not open. */
  readonly revoked: boolean;
  /** Told how the revocation ended, once the list has been asked for again. */
  readonly onOutcome: (outcome: RevokeOutcome) => void;
  /** The row is gone from the list after a revocation: the screen puts focus somewhere. */
  readonly onVanished: () => void;
}

/**
 * What the revoke dialog of one row holds and does (E18-S07). The dialog is controlled, because it stays open while the request is out
 * and when it fails: the confirm button of an `AlertDialog` also asks to close it, and `holdOpen` is how that one request is refused (the
 * click handler runs first and marks it). Confirming with no reason is no request: the field says it is needed. Opening clears what
 * an earlier attempt left. A row that was revoked, or found revoked already, and then leaves the list (a filter on the other states)
 * calls `onVanished` as it goes, because the focus that was on its button has nowhere to return to.
 */
export function useRevokeDialog({ installationId, signatureId, revoked, onOutcome, onVanished }: RevokeDialogInput) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RevokeReason | ''>('');
  const [missing, setMissing] = useState(false);
  const holdOpen = useRef(false);
  const settle = useVanished(onVanished);
  const { revoke, pending, failure, reset } = useRevokeSignature({
    installationId,
    signatureId,
    onOutcome: (outcome) => {
      settle();
      setOpen(false);
      onOutcome(outcome);
    },
  });
  return {
    open,
    onOpenChange: (next: boolean) => {
      if (next) {
        if (!revoked) {
          reset();
          setReason('');
          setMissing(false);
          setOpen(true);
        }
      } else if (holdOpen.current) {
        holdOpen.current = false;
      } else if (!pending) {
        setOpen(false);
      }
    },
    reason,
    choose: (chosen: RevokeReason | '') => {
      setReason(chosen);
      setMissing(false);
    },
    missing,
    confirm: () => {
      holdOpen.current = true;
      if (reason === '') {
        setMissing(true);
      } else {
        revoke(reason);
      }
    },
    pending,
    failure,
  };
}
