// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { REPOSITORY_SEARCH_MAX_LENGTH } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { DebouncedSearch } from '../ui/DebouncedSearch.tsx';
import { Field, Select } from '../ui/index.ts';
import { ALL, enabledOf, enabledValue, type Filters, queryOf } from './repository-filters.ts';

export interface RepositoryFiltersProps {
  readonly filters: Filters;
  /** Puts other filters in the address; the page starts again from the first. */
  readonly onChange: (filters: Filters) => void;
}

/**
 * The search and the filter of the Repositories screen (E18-S10): the name, searched by the server 300 ms after the last key or at once on
 * Enter, and whether the check is on. Each change is a new address, so a filtered view can be shared and survives a reload and Back.
 */
export function RepositoryFilters({ filters, onChange }: RepositoryFiltersProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <DebouncedSearch
        value={filters.q}
        onSearch={(q) => {
          onChange({ ...filters, q });
        }}
        normalise={queryOf}
        maxLength={REPOSITORY_SEARCH_MAX_LENGTH}
        label={t('repositories.search.label')}
        field={t('repositories.search.field')}
        help={t('repositories.search.help')}
      />
      <Field label={t('repositories.filter.enabled')}>
        <Select
          options={[
            { value: ALL, label: t('repositories.filter.enabled.all') },
            { value: 'true', label: t('status.enabled') },
            { value: 'false', label: t('status.disabled') },
          ]}
          value={enabledValue(filters.enabled)}
          onChange={(event) => {
            onChange({ ...filters, enabled: enabledOf(event.target.value) });
          }}
        />
      </Field>
    </div>
  );
}
