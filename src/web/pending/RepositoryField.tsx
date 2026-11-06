// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SCOPE_REPOSITORIES } from '../documents/document-queries.ts';
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { Field, Select, type SelectOption } from '../ui/index.ts';
import type { RepositoryChoices } from './use-repository-choices.ts';

export interface RepositoryFieldProps {
  readonly choices: RepositoryChoices;
  /** The repository of the address, or `undefined` for none. */
  readonly value: number | undefined;
  readonly label: string;
  readonly description?: string;
  /** The words of the choice that stands for no repository: "All repositories" or "Choose a repository". */
  readonly none: string;
  /** The choice is needed before anything is shown. */
  readonly required?: boolean;
  /** The words of a repository the list does not hold, named by its id: shown when the address carries one. */
  readonly byId?: ((id: number) => string) | undefined;
  readonly onChange: (repositoryId: number | undefined) => void;
}

/**
 * The choice of a repository of the tenant in the address (E18-S08): the first hundred by name, the choice of none, and, when the address
 * names a repository the list does not hold and `byId` says it may be shown, that one by its id. The list is of this installation only,
 * so nothing here offers a repository of another tenant. A line says when there are more repositories than are listed, and the error
 * state, with "Try again", when the list cannot be read.
 */
export function RepositoryField({
  choices,
  value,
  label,
  description,
  none,
  required = false,
  byId,
  onChange,
}: RepositoryFieldProps) {
  const t = useT();
  const { query, items, truncated } = choices;
  const options: readonly SelectOption[] = [
    { value: '', label: none },
    ...items.map(({ id, fullName }) => ({ value: String(id), label: fullName })),
    ...(value === undefined || byId === undefined || items.some((item) => item.id === value)
      ? []
      : [{ value: String(value), label: byId(value) }]),
  ];
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} description={description} required={required}>
        <Select
          options={options}
          value={value === undefined ? '' : String(value)}
          disabled={query.isPending}
          onChange={(event) => {
            onChange(event.target.value === '' ? undefined : Number(event.target.value));
          }}
        />
      </Field>
      {query.isError ? (
        <ErrorState variant="banner" error={query.error} refetch={query.refetch} retrying={query.isFetching} />
      ) : null}
      {truncated ? (
        <p className="text-sm text-fg-muted">{t('pending.repository.more', { count: SCOPE_REPOSITORIES })}</p>
      ) : null}
    </div>
  );
}
