// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Linter } from 'eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { webLayerSelectors } from '../eslint-layers.ts';

// The ESLint rules that only src/web needs (E17-S01, E17-S02), as flat-config blocks that eslint.config.mjs appends. They
// live here, in a module Vitest can import, so that scripts/web/eslint-config.test.ts proves with real snippets that each
// one fires. The layering of src/web (it may not import src/server) is in scripts/eslint-layers.ts with the other layers.

/** Text a person can read starts with a letter of any script; `alt=""` (a decorative image) and `{n}` are not text. */
const LETTER = String.raw`/\p{L}/u`;

/** The props whose value a screen reader or a tooltip reads out. */
const TEXT_PROPS = '/^(?:aria-label|title|placeholder|alt|label)$/';

const catalogMessage = 'User-visible text comes from the message catalog: use t(...) from useT() (E17-S02).';

/**
 * The selectors of E17-S02: no user-visible string is written inline in a component. They catch JSX text with a letter in
 * it and a string literal, with or without braces, or a template literal in a prop that is read out. A string that
 * reaches the prop through a variable or a call (`aria-label={t('common.close')}`) is the point, and is allowed.
 */
export const inlineTextSelectors: { selector: string; message: string }[] = [
  { selector: `JSXText[value=${LETTER}]`, message: catalogMessage },
  { selector: `JSXAttribute[name.name=${TEXT_PROPS}] > Literal[value=${LETTER}]`, message: catalogMessage },
  {
    selector: `JSXAttribute[name.name=${TEXT_PROPS}] > JSXExpressionContainer > Literal[value=${LETTER}]`,
    message: catalogMessage,
  },
  {
    selector: `JSXAttribute[name.name=${TEXT_PROPS}] > JSXExpressionContainer > TemplateLiteral:has(TemplateElement[value.raw=${LETTER}])`,
    message: catalogMessage,
  },
];

/**
 * The Rules of Hooks and the React Compiler's rules, as the plugin recommends them. Some are shipped as `warn`; `yarn
 * lint:eslint` runs with --max-warnings 0, so every one of them fails the gate all the same. Then the inline-text rule
 * for the components: every .tsx file of src/web except the tests and their support code, which write the strings they
 * assert on. It repeats the layering selectors, because a block that sets `no-restricted-syntax` replaces theirs.
 */
export const webConfigs: Linter.Config[] = [
  { files: ['src/web/**/*.{ts,tsx}'], ...reactHooks.configs.flat.recommended },
  {
    files: ['src/web/**/*.tsx'],
    ignores: ['**/*.test.tsx', 'src/web/test-support/**'],
    rules: { 'no-restricted-syntax': ['error', ...webLayerSelectors, ...inlineTextSelectors] },
  },
];
