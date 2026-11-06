// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import { Button } from './Button.tsx';
import { FOOTER_CLASSES } from './overlay.tsx';

export interface AlertDialogActionsProps {
  /** The label of the button that does it: a verb ("Revoke"), not "OK". */
  readonly confirmLabel: ReactNode;
  /** Runs when the person chooses to go ahead; the dialog then closes unless `open` is controlled and the screen keeps it open. */
  readonly onConfirm: () => void;
  /** Says no. Absent, it is "Cancel" from the catalog. */
  readonly cancelLabel?: ReactNode;
  /** The action cannot be undone: the confirm button is the danger one. */
  readonly destructive?: boolean;
  /** The action is under way: the confirm button is busy and ignores clicks. Keep the dialog open meanwhile with a controlled `open`. */
  readonly confirming?: boolean;
  /** The action cannot be taken yet (what it needs is not there): the confirm button is disabled, and the dialog still closes with Cancel. */
  readonly confirmDisabled?: boolean;
}

/**
 * The two answers of an AlertDialog (E17-S10). Cancel is Radix's `Cancel`, which is where focus starts; the confirm button is
 * Radix's `Action`, so either closes the dialog. The confirm button's click runs `onConfirm` first, and not at all while
 * `confirming`, because a busy `Button` ignores clicks.
 */
export function AlertDialogActions({
  confirmLabel,
  onConfirm,
  cancelLabel,
  destructive = false,
  confirming = false,
  confirmDisabled = false,
}: AlertDialogActionsProps) {
  const t = useT();
  return (
    <div className={FOOTER_CLASSES}>
      <AlertDialogPrimitive.Cancel asChild>
        <Button variant="secondary">{cancelLabel ?? t('common.cancel')}</Button>
      </AlertDialogPrimitive.Cancel>
      <AlertDialogPrimitive.Action asChild>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          loading={confirming}
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </AlertDialogPrimitive.Action>
    </div>
  );
}
