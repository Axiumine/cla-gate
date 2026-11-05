// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Field } from '../ui/Field.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import { isBlank } from './entries.ts';

export interface TextEntryProps {
  readonly label: string;
  readonly description: string;
  readonly autoComplete: string;
  readonly maxLength: number;
  readonly value: string;
  /** The form was submitted once: an empty entry now says so. */
  readonly attempted: boolean;
  readonly onChange: (value: string) => void;
}

/** One line of text with its label, its help and, after a submit, the word that it is missing (E21-S02). */
export function TextEntry({ label, description, autoComplete, maxLength, value, attempted, onChange }: TextEntryProps) {
  const t = useT();
  return (
    <div className="w-full">
      <Field
        label={label}
        description={description}
        error={attempted && isBlank(value) ? t('corporate.sign.fieldRequired') : undefined}
        required
      >
        <TextInput
          autoComplete={autoComplete}
          maxLength={maxLength}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </Field>
    </div>
  );
}
