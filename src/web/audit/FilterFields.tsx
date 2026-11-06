// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { AUDIT_ACTIONS } from '../../shared/audit.ts';
import { useT } from '../i18n/index.ts';
import { Field, Select, type SelectOption, TextInput } from '../ui/index.ts';
import { actionLabelKey } from './audit-actions.ts';
import type { FilterField, FilterProblem } from './audit-filter-form.ts';
import { type TextField, wordsOf } from './filter-words.ts';

// The fields of the audit filter form (E18-S09).

export interface ActionFilterProps {
  readonly value: string;
  readonly onChange: (field: FilterField, value: string) => void;
}

/** The one action to narrow the log to: the choices are the catalogue of audit actions by their labels, and "All actions" is none. */
export function ActionFilter({ value, onChange }: ActionFilterProps) {
  const t = useT();
  const actions: readonly SelectOption[] = AUDIT_ACTIONS.map((action) => ({
    value: action,
    label: t(actionLabelKey(action)),
  })).toSorted((a, b) => a.label.localeCompare(b.label));
  return (
    <Field label={t('audit.filter.action')}>
      <Select
        options={[{ value: '', label: t('audit.filter.action.all') }, ...actions]}
        value={value}
        onChange={(event) => {
          onChange('action', event.target.value);
        }}
      />
    </Field>
  );
}

export interface TextFilterProps {
  readonly field: TextField;
  readonly value: string;
  /** What is wrong with the text, once a submit found it. */
  readonly problem: FilterProblem | undefined;
  readonly onChange: (field: FilterField, value: string) => void;
}

/** A typed filter: its label, the help that stays visible, and the error under it when the text is not a value. */
export function TextFilter({ field, value, problem, onChange }: TextFilterProps) {
  const t = useT();
  const words = wordsOf(field);
  const invalid = problem === 'before_from' ? 'audit.filter.to.beforeFrom' : words.invalid;
  return (
    <Field label={t(words.label)} description={t(words.help)} error={problem === undefined ? undefined : t(invalid)}>
      <TextInput
        value={value}
        inputMode={words.inputMode}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onChange(field, event.target.value);
        }}
      />
    </Field>
  );
}
