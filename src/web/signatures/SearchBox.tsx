// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useEffectEvent, useState } from 'react';
import { SIGNATURE_SEARCH_MAX_LOGIN } from '../../shared/signature-search.ts';
import { useT } from '../i18n/index.ts';
import { Field, TextInput } from '../ui/index.ts';
import { queryOf } from './signature-filters.ts';

/**
 * How long the search waits after the last key before it asks the server: a pause in typing, not every letter.
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SEARCH_DEBOUNCE_MS = 300;

export interface SearchBoxProps {
  /** The search of the address, in the form `queryOf` gives. */
  readonly q: string | undefined;
  /** Puts this search in the address (`undefined` is none). */
  readonly onSearch: (q: string | undefined) => void;
}

/**
 * The one search box of the signatures screen (E18-S07): an `<input type="search">` that asks 300 ms after the last key, or at once on
 * Enter. What it asks for is one of the two exact filters of the endpoint, and the help says which: a login, matched exactly in
 * any case, or a numeric GitHub id. The text is the person's own until it is sent; when the address changes by itself (Back) the
 * box follows it, and when the address only caught up with what was typed (a trailing space) the box is left alone.
 */
export function SearchBox({ q, onSearch }: SearchBoxProps) {
  const t = useT();
  const [text, setText] = useState(q ?? '');
  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    setSeen(q);
    if (queryOf(text) !== q) {
      setText(q ?? '');
    }
  }
  const ask = useEffectEvent(onSearch);
  const wanted = queryOf(text);
  useEffect(() => {
    if (wanted === q) {
      return undefined;
    }
    const timer = setTimeout(() => {
      ask(wanted);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [wanted, q]);
  return (
    <search aria-label={t('signatures.search.label')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (wanted !== q) {
            onSearch(wanted);
          }
        }}
      >
        <Field label={t('signatures.search.field')} description={t('signatures.search.help')}>
          <TextInput
            type="search"
            value={text}
            maxLength={SIGNATURE_SEARCH_MAX_LOGIN}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </Field>
      </form>
    </search>
  );
}
