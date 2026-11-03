// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';
import { BASE_CLASSES, type ButtonVariant, VARIANT_CLASSES } from './button-styles.ts';
import { classNames } from './class-names.ts';

/** A button shows a label, or an icon with an accessible name: an icon alone without `aria-label` does not compile. */
type ButtonContent =
  | { readonly children: ReactNode; readonly icon?: ReactNode }
  | { readonly children?: undefined; readonly icon: ReactNode; readonly 'aria-label': string };

export type ButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-busy'> &
  ButtonContent & {
    readonly variant?: ButtonVariant;
    /** Busy: announced through `aria-busy`, clicks (and the submit of a form) are ignored, and focus stays on the button. */
    readonly loading?: boolean;
  };

/**
 * A button (E17-S06). `type` is `button` unless the caller says `submit`, so a button in a form never submits by accident.
 * While `loading` it is not `disabled`: a disabled button drops out of the tab order and loses focus, which would take the
 * keyboard user's place away in the middle of an action.
 */
export function Button({
  variant = 'secondary',
  loading = false,
  type = 'button',
  icon,
  children,
  className,
  onClick,
  ...props
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  // eslint-disable-next-line security/detect-object-injection -- variant is the closed ButtonVariant union, never user input
  const look = VARIANT_CLASSES[variant];
  return (
    <button
      {...props}
      type={type}
      aria-busy={loading ? true : undefined}
      onClick={handleClick}
      className={classNames(BASE_CLASSES, look, className)}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
