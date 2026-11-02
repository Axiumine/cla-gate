// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { MIN_REASON_LENGTH } from './reason.ts';

// E20-S16: the ESLint half of the escape-hatch justification gate, as a flat-config block that eslint.config.mjs
// appends. It lives here, in a module Vitest can import, so that scripts/escape-hatches/eslint-config.test.ts feeds violating
// source text to ESLint's Linter class with this very block. Biome's biome-ignore needs no rule of ours (a suppression
// without an explanation is a `suppressions/parse` error), and scripts/check-escape-hatches.ts covers what no linter does.

/** Every extension the caps tool measures, so that no source file escapes the rules. */
const SOURCE_FILES = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

export const escapeHatchConfig: Linter.Config = {
  name: 'escape-hatches',
  files: SOURCE_FILES,
  plugins: {
    '@typescript-eslint': tseslint.plugin,
    '@eslint-community/eslint-comments': { rules: eslintComments.rules },
  },
  // A directive that no longer suppresses anything is an error, so a stale justification cannot linger.
  linterOptions: { reportUnusedDisableDirectives: 'error' },
  rules: {
    '@typescript-eslint/ban-ts-comment': [
      'error',
      {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
        minimumDescriptionLength: MIN_REASON_LENGTH,
      },
    ],
    // Every directive says why (`-- reason`), every one names its rules, every block disable is closed again. A
    // disable comment at the very top of a file, before any code, switches a rule off for the whole file and needs no pair.
    '@eslint-community/eslint-comments/require-description': 'error',
    '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
    '@eslint-community/eslint-comments/disable-enable-pair': ['error', { allowWholeFile: true }],
  },
};
