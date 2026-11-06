// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Field, Select } from '../ui/index.ts';
import { type DocumentChoice, optionsOf } from './document-choices.ts';

export interface ChoiceFieldProps {
  readonly choices: readonly DocumentChoice[];
  /** The document the repository enforces now: always an option. */
  readonly current: DocumentChoice | null;
  /** The value of the choice on screen. */
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** The select of the attach dialog (E18-S10): no CLA to detach, or one of the documents of the repository. */
export function ChoiceField({ choices, current, value, onChange }: ChoiceFieldProps) {
  const t = useT();
  return (
    <Field label={t('repositories.attach.field')}>
      <Select
        options={optionsOf(choices, current, t)}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}
