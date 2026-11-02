// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ReactNode, useId } from 'react';
import type { FieldState } from './field-context.ts';

/** Whether `node` shows anything: not absent, not a boolean, not an empty string. */
export function isShown(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== 'boolean' && node !== '';
}

/** The ids of one field, from one `useId`, and what the control is told of them. */
export function useFieldState(shown: { description: boolean; error: boolean; required: boolean }) {
  const base = useId();
  const ids = {
    control: `${base}-control`,
    label: `${base}-label`,
    description: `${base}-description`,
    error: `${base}-error`,
  };
  const described = [shown.description ? ids.description : undefined, shown.error ? ids.error : undefined].filter(
    (id) => id !== undefined,
  );
  const state: FieldState = {
    controlId: ids.control,
    labelId: ids.label,
    describedBy: described.length === 0 ? undefined : described.join(' '),
    invalid: shown.error,
    required: shown.required,
  };
  return { ids, state };
}
