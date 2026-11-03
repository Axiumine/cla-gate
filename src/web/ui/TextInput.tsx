// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ComponentPropsWithRef } from 'react';
import { classNames } from './class-names.ts';
import { TEXT_CONTROL_CLASSES } from './control-styles.ts';
import { useFieldControl } from './field-context.ts';

/** The input types that hold text a person types; the others (a checkbox, a file) have their own primitives or none. */
export type TextInputType = 'text' | 'email' | 'search' | 'url' | 'tel' | 'password';

export type TextInputProps = Omit<ComponentPropsWithRef<'input'>, 'type'> & { readonly type?: TextInputType };

/** A one-line text field. Inside a `Field` it takes its id, description, error and required state from it (E17-S06). */
export function TextInput({ type = 'text', className, ...props }: TextInputProps) {
  const { aria } = useFieldControl(props);
  return <input {...props} {...aria} type={type} className={classNames(TEXT_CONTROL_CLASSES, className)} />;
}
