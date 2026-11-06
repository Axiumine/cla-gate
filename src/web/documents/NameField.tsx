// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Field, TextInput } from '../ui/index.ts';

export interface NameFieldProps {
  readonly value: string;
  /** A rule the name broke, as the catalog key of its words; `undefined` while it is fine. */
  readonly rule: 'invalid_name' | 'document_name_taken' | 'document_limit_reached' | undefined;
  readonly onChange: (name: string) => void;
}

/** The name of the document (E18-S05): 1 to 100 characters, with the rule the create broke shown under it. */
export function NameField({ value, rule, onChange }: NameFieldProps) {
  const t = useT();
  return (
    <Field
      label={t('documents.new.name')}
      description={t('documents.new.nameHelp')}
      required
      error={rule === undefined ? undefined : t(`documents.rule.${rule}`)}
    >
      <TextInput
        value={value}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}
