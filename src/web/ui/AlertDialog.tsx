// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { AlertDialogActions, type AlertDialogActionsProps } from './AlertDialogActions.tsx';
import {
  BACKDROP_CLASSES,
  DESCRIPTION_CLASSES,
  keepOpen,
  PANEL_CLASSES,
  ScrollLock,
  TITLE_CLASSES,
  useOverlayFocus,
} from './overlay.tsx';

export interface AlertDialogProps extends AlertDialogActionsProps {
  /** The question, as the accessible name and the heading: text from the catalog, or user text through `UserText`. */
  readonly title: ReactNode;
  /** What the choice does, in full: read out after the name. An alert dialog always says what is at stake. */
  readonly description: ReactNode;
  /** Escape answers the question with "no", like Cancel does, instead of doing nothing: for a question whose safe answer is the one Escape gives (E18-S14). */
  readonly escapeCancels?: boolean;
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
 * safe answer), Escape and a click outside do nothing, and only Cancel or the confirm button close it. A question that opts in with
 * `escapeCancels` (E18-S14) is also answered "no" by Escape; a click outside still does nothing. Everything else a
 * `Dialog` does (focus trap, focus back to the trigger, no injected style) it does too.
 */
export function AlertDialog({
  title,
  description,
  escapeCancels = false,
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  ...actions
}: AlertDialogProps) {
  const focus = useOverlayFocus(trigger !== undefined);
  return (
    <AlertDialogPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger === undefined ? null : <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>}
      <AlertDialogPrimitive.Portal>
        <div className={BACKDROP_CLASSES}>
          <AlertDialogPrimitive.Content
            className={PANEL_CLASSES}
            onEscapeKeyDown={escapeCancels ? undefined : keepOpen}
            {...focus}
          >
            <ScrollLock />
            <AlertDialogPrimitive.Title className={TITLE_CLASSES}>{title}</AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className={DESCRIPTION_CLASSES}>
              {description}
            </AlertDialogPrimitive.Description>
            {children}
            <AlertDialogActions {...actions} />
          </AlertDialogPrimitive.Content>
        </div>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
