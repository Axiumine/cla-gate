// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import { Button } from './Button.tsx';
import { classNames } from './class-names.ts';
import {
  BACKDROP_CLASSES,
  DESCRIPTION_CLASSES,
  FOOTER_CLASSES,
  PANEL_CLASSES,
  ScrollLock,
  TITLE_CLASSES,
  useOverlayFocus,
} from './overlay.tsx';

export interface DialogProps {
  /** The accessible name of the dialog and its heading: text from the catalog, or user text through `UserText`. */
  readonly title: ReactNode;
  /** What the dialog is for, read out after the name; also shown. */
  readonly description?: ReactNode;
  /** The element that opens it, usually a `Button`. Focus returns to it when the dialog closes. */
  readonly trigger?: ReactElement;
  /** The actions of the dialog: wrap the one that only closes it in `DialogClose`. */
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
  /** Controlled: the screen holds the state and `onOpenChange` asks it to change. Absent, the dialog holds its own. */
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** Closes the dialog it stands in when it is activated. `children` is the button; it keeps its own look and label. */
export function DialogClose({ children }: { readonly children: ReactElement }) {
  return <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>;
}

/**
 * A modal dialog on Radix's (E17-S10): focus moves in, Tab and Shift+Tab stay inside, the rest of the page is hidden from
 * assistive technology, and Escape, the close button or a click outside closes it and puts focus back where it was. Radix's
 * overlay is not used, and nothing is added to the document's styles (see overlay.tsx). A dialog that must not be left by
 * accident, or that asks a question about something that cannot be undone, is an `AlertDialog`.
 */
export function Dialog({ title, description, trigger, footer, children, ...root }: DialogProps) {
  const t = useT();
  const focus = useOverlayFocus(trigger !== undefined);
  return (
    <DialogPrimitive.Root {...root}>
      {trigger === undefined ? null : <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <div className={BACKDROP_CLASSES}>
          <DialogPrimitive.Content className={PANEL_CLASSES} {...focus}>
            <ScrollLock />
            <DialogPrimitive.Title className={classNames(TITLE_CLASSES, 'pr-8')}>{title}</DialogPrimitive.Title>
            {description === undefined ? null : (
              <DialogPrimitive.Description className={DESCRIPTION_CLASSES}>{description}</DialogPrimitive.Description>
            )}
            {children}
            {footer === undefined ? null : <div className={FOOTER_CLASSES}>{footer}</div>}
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" icon="×" aria-label={t('common.close')} className="absolute top-3 right-3 px-2" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
