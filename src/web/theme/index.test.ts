// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import * as theme from './index.ts';

test('the barrel exports what the screens import for the theme, and nothing else', () => {
  expect(new Set(Object.keys(theme))).toEqual(new Set(['ThemeProvider', 'ThemeToggle']));
});
