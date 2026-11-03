// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type ReactNode, useEffect, useMemo } from 'react';
import { I18nContext, type I18nValue, type Locale } from './context.ts';
import { createFormatters } from './format.ts';
import { messages } from './messages.ts';
import { createTranslator } from './translate.ts';

export const DEFAULT_LOCALE: Locale = 'en';

export interface I18nProviderProps {
  readonly locale?: Locale;
  readonly children: ReactNode;
}

/**
 * Supplies the locale, `t` and the formatters to everything below it, and keeps `<html lang>` equal to the locale so
 * screen readers pronounce the page right (E17-S02). It sits above every other provider and boundary of the app, whose
 * fallbacks also show text.
 */
export function I18nProvider({ locale = DEFAULT_LOCALE, children }: I18nProviderProps) {
  const value = useMemo<I18nValue>(
    () => ({ locale, t: createTranslator(messages, locale), formatters: createFormatters(locale) }),
    [locale],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}
