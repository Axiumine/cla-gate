// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// What the rest of the app imports to show text and moments (E17-S02). A Knip production entry until the screens of E18
// import these exports from production code; then remove the entry from knip.json.
export { type I18nValue, type Locale, useFormatters, useLocale, useT } from './context.ts';
export { type Formatters, type Instant, parseInstant } from './format.ts';
export { DEFAULT_LOCALE, I18nProvider, type I18nProviderProps } from './I18nProvider.tsx';
export { type MessageKey, type Messages, messages, type PlainMessageKey } from './messages.ts';
export { Timestamp, type TimestampProps } from './Timestamp.tsx';
export { createTranslator, type Translate } from './translate.ts';
