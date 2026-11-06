// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useEffectEvent, useState } from 'react';
import { Field } from './Field.tsx';
import { TextInput } from './TextInput.tsx';

/**
 * How long a search waits after the last key before it asks the server: a pause in typing, not every letter.
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SEARCH_DEBOUNCE_MS = 300;

export interface DebouncedSearchProps {
  /** The search of the address, in the form `normalise` gives. */
  readonly value: string | undefined;
  /** Puts this search in the address (`undefined` is none). */
  readonly onSearch: (value: string | undefined) => void;
  /** The one cleaning of a text: the trimmed search, or `undefined` for a text that is no search. The same as the address uses. */
  readonly normalise: (text: string) => string | undefined;
  /** The most characters the input takes. */
  readonly maxLength: number;
  /** The name of the `<search>` landmark: text from the catalog. */
  readonly label: string;
  /** The label of the input: text from the catalog. */
  readonly field: string;
  /** What the search matches, under the label: text from the catalog. */
  readonly help: string;
}

/**
 * The search box of a list (E18-S07, E18-S10): an `<input type="search">` that asks 300 ms after the last key, or at once on Enter. The
 * text is the person's own until it is sent; when the address changes by itself (Back) the box follows it, and when the address only
 * caught up with what was typed (a trailing space) the box is left alone.
 */
export function DebouncedSearch({ value, onSearch, normalise, maxLength, label, field, help }: DebouncedSearchProps) {
  const [text, setText] = useState(value ?? '');
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (normalise(text) !== value) {
      setText(value ?? '');
    }
  }
  const ask = useEffectEvent(onSearch);
  const wanted = normalise(text);
  useEffect(() => {
    if (wanted === value) {
      return undefined;
    }
    const timer = setTimeout(() => {
      ask(wanted);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [wanted, value]);
  return (
    <search aria-label={label}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (wanted !== value) {
            onSearch(wanted);
          }
        }}
      >
        <Field label={field} description={help}>
          <TextInput
            type="search"
            value={text}
            maxLength={maxLength}
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
