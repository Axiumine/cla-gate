// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useHeldDialog } from '../ui/use-held-dialog.ts';
import type { RepositoryChangeTarget } from './use-repository-change.ts';
import { useSwitchRepository } from './use-switch-repository.ts';

/**
 * The state of the dialog that turns the check of a repository off (E18-S10): whether it is open, the disable request behind it, and
 * what its buttons do. Confirming holds the dialog open, because Radix closes an alert dialog on its confirm button and the request is
 * still out; the dialog closes when the lists have been asked for again. Opening it again forgets the failure of the last time.
 */
export function useDisableDialog({ onOutcome, ...target }: RepositoryChangeTarget) {
  const dialog = useHeldDialog();
  const change = useSwitchRepository('disable', {
    ...target,
    onOutcome: (outcome) => {
      dialog.close();
      onOutcome(outcome);
    },
  });
  const disable = () => {
    change.send(undefined);
  };
  return {
    open: dialog.open,
    change,
    disable,
    onOpenChange: (next: boolean) => {
      if (next) {
        change.reset();
      }
      dialog.onOpenChange(next, change.pending);
    },
    confirm: () => {
      dialog.hold();
      disable();
    },
  };
}
