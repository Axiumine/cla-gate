// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useHeldDialog } from '../ui/use-held-dialog.ts';
import { useVanished } from '../ui/use-vanished.ts';
import { type RemoveOverrideInput, useRemoveOverride } from './use-remove-override.ts';

export interface RemoveDialogInput extends RemoveOverrideInput {
  /** The row is gone from the list after the removal: the screen puts focus somewhere. */
  readonly onVanished: () => void;
}

/**
 * The state of the removal dialog (E18-S08): whether it is open, the removal behind it, and what its buttons do. Confirming holds the
 * dialog open, because Radix closes an alert dialog on its confirm button and the request is still out; the dialog closes when the lists
 * have been asked for again, and then the screen is told that the row is gone. Opening it again forgets the failure of the last time.
 */
export function useRemoveDialog({ onVanished, onOutcome, ...input }: RemoveDialogInput) {
  const dialog = useHeldDialog();
  const settle = useVanished(onVanished);
  const removal = useRemoveOverride({
    ...input,
    onOutcome: (outcome) => {
      settle();
      dialog.close();
      onOutcome(outcome);
    },
  });
  return {
    open: dialog.open,
    removal,
    onOpenChange: (next: boolean) => {
      if (next) {
        removal.reset();
      }
      dialog.onOpenChange(next, removal.pending);
    },
    confirm: () => {
      dialog.hold();
      removal.remove();
    },
  };
}
