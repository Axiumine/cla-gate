// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import { classNames } from './class-names.ts';
import { FieldContext } from './field-context.ts';
import { isShown, useFieldState } from './field-state.ts';

export interface FieldProps {
  /** The visible label, from the message catalog or through `UserText` when it holds user text. */
  readonly label: ReactNode;
  /** Help that stays visible: the control is described by it. */
  readonly description?: ReactNode;
  /** What is wrong with the value. Its presence marks the control invalid; it is announced as an alert. */
  readonly error?: ReactNode;
  /** Shows "(required)" in the label and marks the control `aria-required`. */
  readonly required?: boolean;
  /** The control before its label, in a row (a checkbox); the description and the error stay under the label. */
  readonly inline?: boolean;
  /** The control: `TextInput`, `Textarea`, `Select`, `Checkbox` or `RadioGroup`. */
  readonly children: ReactNode;
}

/**
 * A label, an optional description and error, and the control they belong to (E17-S06). The label names the control
 * (`htmlFor`), the description and the error describe it (`aria-describedby`), an error marks it `aria-invalid`, and
 * `required` marks it `aria-required` and writes "(required)" in the label, so the requirement is not colour or a star.
 * The error sits in a `role="alert"` node, which a screen reader announces when it appears.
 */
export function Field({ label, description, error, required = false, inline = false, children }: FieldProps) {
  const t = useT();
  const hasDescription = isShown(description);
  const hasError = isShown(error);
  const { ids, state } = useFieldState({ description: hasDescription, error: hasError, required });
  const beside = inline ? 'col-start-2' : undefined;
  return (
    <FieldContext value={state}>
      <div className={inline ? 'grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1' : 'flex flex-col gap-1'}>
        <label
          id={ids.label}
          htmlFor={ids.control}
          className={classNames('font-medium text-fg', inline && 'col-start-2 row-start-1')}
        >
          {label}
          {required ? (
            <>
              {' '}
              <span className="font-normal text-fg-muted">{t('common.required')}</span>
            </>
          ) : null}
        </label>
        {hasDescription ? (
          <p id={ids.description} className={classNames('text-sm text-fg-muted', beside)}>
            {description}
          </p>
        ) : null}
        <div className={inline ? 'col-start-1 row-start-1' : undefined}>{children}</div>
        {hasError ? (
          <p id={ids.error} role="alert" className={classNames('text-sm text-danger-fg', beside)}>
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext>
  );
}
