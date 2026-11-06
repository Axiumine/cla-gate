// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Field, Select } from '../ui/index.ts';
import { ALL, documentOf, documentOptions, stateOf, stateOptions } from './filter-options.ts';
import { SearchBox } from './SearchBox.tsx';
import type { Filters } from './signature-filters.ts';
import type { DocumentChoice } from './use-document-choices.ts';

export interface SignatureFiltersProps {
  readonly filters: Filters;
  readonly documents: readonly DocumentChoice[];
  /** Puts other filters in the address; the page starts again from the first. */
  readonly onChange: (filters: Filters) => void;
}

/**
 * The search and the two filters of the signatures screen (E18-S07): the status (all, active, outdated, revoked) and the document. The
 * document choices are the ones the viewer may read; a document that is only in the address is still a choice, named by its id, and
 * the server decides about it. Each change is a new address, so a filtered view can be shared and survives a reload and Back.
 */
export function SignatureFilters({ filters, documents, onChange }: SignatureFiltersProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <SearchBox
        q={filters.q}
        onSearch={(q) => {
          onChange({ ...filters, q });
        }}
      />
      <div className="flex flex-wrap gap-4">
        <Field label={t('signatures.filter.state')}>
          <Select
            options={stateOptions(t)}
            value={filters.state ?? ALL}
            onChange={(event) => {
              onChange({ ...filters, state: stateOf(event.target.value) });
            }}
          />
        </Field>
        <Field label={t('signatures.filter.document')}>
          <Select
            options={documentOptions(documents, filters.document, t)}
            value={filters.document === undefined ? ALL : String(filters.document)}
            onChange={(event) => {
              onChange({ ...filters, document: documentOf(event.target.value) });
            }}
          />
        </Field>
      </div>
    </div>
  );
}
