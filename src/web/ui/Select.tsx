// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ComponentPropsWithRef } from 'react';
import { classNames } from './class-names.ts';
import { TEXT_CONTROL_CLASSES } from './control-styles.ts';
import { useFieldControl } from './field-context.ts';

export interface SelectOption {
  readonly value: string;
  /** Plain text: an `<option>` cannot hold markup, which is also why a user-controlled label cannot inject any. */
  readonly label: string;
  readonly disabled?: boolean;
}

export type SelectProps = Omit<ComponentPropsWithRef<'select'>, 'children'> & {
  readonly options: readonly SelectOption[];
};

/**
 * The browser's own `<select>`, styled like the text controls (E17-S06): it brings the keyboard behaviour, the mobile pickers
 * and the screen-reader support of the platform, which a custom listbox would have to rebuild. Inside a `Field` like `TextInput`.
 */
export function Select({ options, className, ...props }: SelectProps) {
  const { aria } = useFieldControl(props);
  return (
    <select {...props} {...aria} className={classNames(TEXT_CONTROL_CLASSES, className)}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
