// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createContext, useContext } from 'react';
import type { Formatters } from './format.ts';
import type { Messages } from './messages.ts';
import type { Translate } from './translate.ts';

/** The locales the app has a catalog for. English only until a second catalog is added (E17-S02). */
export type Locale = 'en';

/** What `I18nProvider` supplies: the locale, `t` and the formatters of that locale. */
export interface I18nValue {
  readonly locale: Locale;
  readonly t: Translate<Messages>;
  readonly formatters: Formatters;
}

export const I18nContext = createContext<I18nValue | null>(null);

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) {
    throw new Error('Text and formatters need an I18nProvider above the component');
  }
  return value;
}

/** The locale the provider supplies: the language of the catalog and the `lang` of the page. */
export function useLocale(): Locale {
  return useI18n().locale;
}

/** `t(key, params?)` and `t.plural(key, count)`, the only way a component reads a message. */
export function useT(): Translate<Messages> {
  return useI18n().t;
}

/** The locale-aware formatters: `formatNumber`, `formatDate`, `formatDateTime` and the UTC form of evidence times. */
export function useFormatters(): Formatters {
  return useI18n().formatters;
}
