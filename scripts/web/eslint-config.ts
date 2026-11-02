// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Linter } from 'eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// The ESLint rules that only src/web needs (E17-S01), as flat-config blocks that eslint.config.mjs appends. They live
// here, in a module Vitest can import, so that scripts/web/eslint-config.test.ts proves with real snippets that each one fires.
// The layering of src/web (it may not import src/server) is in scripts/eslint-layers.ts with the other layers.

/**
 * The Rules of Hooks and the React Compiler's rules, as the plugin recommends them. Some are shipped as `warn`; `yarn
 * lint:eslint` runs with --max-warnings 0, so every one of them fails the gate all the same.
 */
export const webConfigs: Linter.Config[] = [
  { files: ['src/web/**/*.{ts,tsx}'], ...reactHooks.configs.flat.recommended },
];
