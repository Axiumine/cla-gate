// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Field } from '../ui/Field.tsx';
import type { SignEntriesProps } from './entries.ts';
import { TextEntries } from './TextEntries.tsx';

// The entries of the corporate signing form (E21-S02) laid out: three lines of text and the box of authority.

/** The company, the title, the typed name and the box that says the signatory may bind the company. */
export function SignEntries(props: SignEntriesProps) {
  const t = useT();
  const { entries, attempted, onChange } = props;
  return (
    <>
      <TextEntries {...props} />
      <Field
        inline
        label={t('corporate.sign.authority')}
        error={attempted && !entries.authorityConfirmed ? t('corporate.sign.authorityRequired') : undefined}
        required
      >
        <Checkbox
          checked={entries.authorityConfirmed}
          onCheckedChange={(authorityConfirmed) => {
            onChange({ authorityConfirmed });
          }}
        />
      </Field>
    </>
  );
}
