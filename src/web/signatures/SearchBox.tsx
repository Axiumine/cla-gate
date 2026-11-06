// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SIGNATURE_SEARCH_MAX_LOGIN } from '../../shared/signature-search.ts';
import { useT } from '../i18n/index.ts';
import { DebouncedSearch } from '../ui/DebouncedSearch.tsx';
import { queryOf } from './signature-filters.ts';

export interface SearchBoxProps {
  /** The search of the address, in the form `queryOf` gives. */
  readonly q: string | undefined;
  /** Puts this search in the address (`undefined` is none). */
  readonly onSearch: (q: string | undefined) => void;
}

/**
 * The one search box of the signatures screen (E18-S07): a `DebouncedSearch` that asks 300 ms after the last key, or at once on Enter.
 * What it asks for is one of the two exact filters of the endpoint, and the help says which: a login, matched exactly in any case, or
 * a numeric GitHub id.
 */
export function SearchBox({ q, onSearch }: SearchBoxProps) {
  const t = useT();
  return (
    <DebouncedSearch
      value={q}
      onSearch={onSearch}
      normalise={queryOf}
      maxLength={SIGNATURE_SEARCH_MAX_LOGIN}
      label={t('signatures.search.label')}
      field={t('signatures.search.field')}
      help={t('signatures.search.help')}
    />
  );
}
