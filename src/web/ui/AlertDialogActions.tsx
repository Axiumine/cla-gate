// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import { Button } from './Button.tsx';
import { FOOTER_CLASSES } from './overlay.tsx';

interface AlertDialogActionsProps {
  readonly confirmLabel: ReactNode;
  readonly onConfirm: () => void;
  readonly cancelLabel: ReactNode;
  readonly destructive: boolean;
  readonly confirming: boolean;
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
  destructive,
  confirming,
}: AlertDialogActionsProps) {
  const t = useT();
  return (
    <div className={FOOTER_CLASSES}>
      <AlertDialogPrimitive.Cancel asChild>
        <Button variant="secondary">{cancelLabel ?? t('common.cancel')}</Button>
      </AlertDialogPrimitive.Cancel>
      <AlertDialogPrimitive.Action asChild>
        <Button variant={destructive ? 'danger' : 'primary'} loading={confirming} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </AlertDialogPrimitive.Action>
    </div>
  );
}
