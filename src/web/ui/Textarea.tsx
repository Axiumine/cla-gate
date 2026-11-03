// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ComponentPropsWithRef } from 'react';
import { classNames } from './class-names.ts';
import { TEXT_CONTROL_CLASSES } from './control-styles.ts';
import { useFieldControl } from './field-context.ts';

export type TextareaProps = ComponentPropsWithRef<'textarea'>;

/** A multi-line text field, taller than a line (four rows) and resizable in height only. Inside a `Field` like `TextInput`. */
export function Textarea({ rows = 4, className, ...props }: TextareaProps) {
  const { aria } = useFieldControl(props);
  return (
    <textarea {...props} {...aria} rows={rows} className={classNames(TEXT_CONTROL_CLASSES, 'resize-y', className)} />
  );
}
