// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import type { ManifestRequest } from '../../shared/setup.ts';
import { type AppFormField, type AppFormValues, checkAppForm, defaultAppName } from './app-form.ts';

/**
 * What the form holds and does: the values, the fields that failed the last check, a change of a value, and the submit that
 * checks the values against the schema the server checks the request with and, when they pass, calls `onSubmit`. After a
 * failed check the first field that is wrong takes focus.
 */
export function useAppForm(onSubmit: (request: ManifestRequest) => void) {
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<AppFormValues>(() => ({
    ownerType: 'user',
    organisation: '',
    appName: defaultAppName(window.location.host),
    allowOtherAccounts: false,
  }));
  const [wrong, setWrong] = useState<ReadonlySet<AppFormField>>(new Set());
  useEffect(() => {
    if (wrong.size > 0) {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [wrong]);
  const change = (next: Partial<AppFormValues>) => {
    setValues((current) => ({ ...current, ...next }));
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const check = checkAppForm(values);
    setWrong(check.valid ? new Set() : check.wrong);
    if (check.valid) {
      onSubmit(check.request);
    }
  };
  return { form, values, wrong, change, submit };
}
