// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { AlertDialogActions } from './AlertDialogActions.tsx';
import {
  BACKDROP_CLASSES,
  DESCRIPTION_CLASSES,
  keepOpen,
  PANEL_CLASSES,
  ScrollLock,
  TITLE_CLASSES,
  useOverlayFocus,
} from './overlay.tsx';

export interface AlertDialogProps {
  /** The question, as the accessible name and the heading: text from the catalog, or user text through `UserText`. */
  readonly title: ReactNode;
  /** What the choice does, in full: read out after the name. An alert dialog always says what is at stake. */
  readonly description: ReactNode;
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
  /** The element that opens it, usually a `Button`. Focus returns to it when the dialog closes. */
  readonly trigger?: ReactElement;
  /** More for the body: what is affected, in a list. */
  readonly children?: ReactNode;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * A dialog that needs an explicit choice (E17-S10), on Radix's AlertDialog: role `alertdialog`, focus starts on Cancel (the
 * safe answer), Escape and a click outside do nothing, and only Cancel or the confirm button close it. Everything else a
 * `Dialog` does (focus trap, focus back to the trigger, no injected style) it does too.
 */
export function AlertDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  cancelLabel,
  destructive = false,
  confirming = false,
  trigger,
  children,
  ...root
}: AlertDialogProps) {
  const focus = useOverlayFocus(trigger !== undefined);
  return (
    <AlertDialogPrimitive.Root {...root}>
      {trigger === undefined ? null : <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>}
      <AlertDialogPrimitive.Portal>
        <div className={BACKDROP_CLASSES}>
          <AlertDialogPrimitive.Content className={PANEL_CLASSES} onEscapeKeyDown={keepOpen} {...focus}>
            <ScrollLock />
            <AlertDialogPrimitive.Title className={TITLE_CLASSES}>{title}</AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className={DESCRIPTION_CLASSES}>
              {description}
            </AlertDialogPrimitive.Description>
            {children}
            <AlertDialogActions
              confirmLabel={confirmLabel}
              onConfirm={onConfirm}
              cancelLabel={cancelLabel}
              destructive={destructive}
              confirming={confirming}
            />
          </AlertDialogPrimitive.Content>
        </div>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
