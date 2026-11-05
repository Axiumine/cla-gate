// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type SyntheticEvent, useState } from 'react';
import {
  type FilterErrors,
  type FilterField,
  type FilterFormValues,
  parseFilterForm,
  valuesOf,
} from './audit-filter-form.ts';
import type { AuditFilters } from './audit-filters.ts';

const NO_ERRORS: FilterErrors = new Map();

export interface FilterForm {
  readonly values: FilterFormValues;
  /** The fields the last submit could not read; empty until then and after a submit that could. */
  readonly errors: FilterErrors;
  readonly change: (field: FilterField, value: string) => void;
  readonly submit: (event: SyntheticEvent<HTMLFormElement>) => void;
}

/**
 * The state of the audit filter form (E18-S09): the text of the fields, starting from the filters of the address, and the errors of the
 * last submit. A submit that reads as filters hands them to `onApply` (which puts them in the address); one that does not asks for
 * nothing and shows the fields that cannot be read, with what was typed left as it was.
 */
export function useFilterForm(filters: AuditFilters, onApply: (filters: AuditFilters) => void): FilterForm {
  const [values, setValues] = useState(() => valuesOf(filters));
  const [errors, setErrors] = useState(NO_ERRORS);
  return {
    values,
    errors,
    change: (field, value) => {
      setValues((current) => ({ ...current, [field]: value }));
    },
    submit: (event) => {
      event.preventDefault();
      const parsed = parseFilterForm(values);
      setErrors(parsed.ok ? NO_ERRORS : parsed.errors);
      if (parsed.ok) {
        onApply(parsed.filters);
      }
    },
  };
}
