// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Field, Select, type SelectOption } from '../ui/index.ts';

export interface ScopeFieldProps {
  readonly value: string;
  /** The repositories the document can be scoped to; the choice of the whole installation is always there. */
  readonly repositories: readonly { readonly id: number; readonly fullName: string }[];
  /** The repositories are still being asked for. */
  readonly loading: boolean;
  readonly onChange: (scope: string) => void;
}

/** The scope of the document (E18-S05): the whole installation, or one repository by its full name (text a person controls, shown as such). */
export function ScopeField({ value, repositories, loading, onChange }: ScopeFieldProps) {
  const t = useT();
  const options: readonly SelectOption[] = [
    { value: '', label: t('documents.new.scopeInstallation') },
    ...repositories.map(({ id, fullName }) => ({ value: String(id), label: fullName })),
  ];
  return (
    <Field label={t('documents.new.scope')} description={t('documents.new.scopeHelp')}>
      <Select
        options={options}
        value={value}
        disabled={loading}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}
