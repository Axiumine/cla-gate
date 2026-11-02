// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentPropsWithoutRef } from 'react';
import { classNames } from './class-names.ts';
import { useFieldControl } from './field-context.ts';

type RootProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

/** Two states only: the indeterminate state of Radix's checkbox has no place in a form that records a yes or a no. */
export type CheckboxProps = Omit<RootProps, 'checked' | 'defaultChecked' | 'onCheckedChange' | 'children'> & {
  readonly checked?: boolean;
  readonly defaultChecked?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
};

/**
 * A checkbox on Radix's (E17-S06): Space toggles it, it is a `role="checkbox"` button with `aria-checked`, and it submits
 * with its form through a hidden input. Inside a `Field` the label names it; standing alone it needs an `aria-label`.
 */
export function Checkbox({ onCheckedChange, className, ...props }: CheckboxProps) {
  const { aria } = useFieldControl(props);
  return (
    <CheckboxPrimitive.Root
      {...props}
      {...aria}
      onCheckedChange={(state) => {
        onCheckedChange?.(state === true);
      }}
      className={classNames(
        'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line bg-surface text-on-accent data-[state=checked]:border-accent data-[state=checked]:bg-accent aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator>
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="size-4">
          <path d="M3 8.5l3.5 3.5L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
