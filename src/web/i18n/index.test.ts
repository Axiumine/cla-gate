// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import * as i18n from './index.ts';

test('the barrel exports what the screens import to show text and moments, and nothing else', () => {
  expect(new Set(Object.keys(i18n))).toEqual(
    new Set([
      'DEFAULT_LOCALE',
      'I18nProvider',
      'Timestamp',
      'createTranslator',
      'messages',
      'parseInstant',
      'useFormatters',
      'useLocale',
      'useT',
    ]),
  );
});
