// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// ESLint is a zero-findings gate next to Biome (`yarn lint` runs both, ESLint with --max-warnings 0), so a rule
// is either an error or off. Biome formats, sorts imports and runs the fast syntactic rules; ESLint adds the
// type-aware rules (typescript-eslint strictTypeChecked), SonarJS, eslint-plugin-security and no-unsanitized.
//
// eslint-config-biome is deliberately NOT used: it switches off 557 rules, including the type-aware
// no-floating-promises, no-misused-promises and switch-exhaustiveness-check, whose Biome counterparts are still
// `nursery` with severity `info` in Biome 2.6. Dropping them would weaken the gate.
//
// Type information comes from the TypeScript project service: the solution-style tsconfig.json points at
// tsconfig.scripts.json (scripts/) and tsconfig.node.json (root config files). The architecture
// no-restricted-imports overrides (src/shared, src/server, src/web) join this file with the code they restrict.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

/** Same counting as scripts/code-caps/measure.ts: a function or file is its whole line span, blanks and comments included. */
const counting = { skipBlankLines: false, skipComments: false };

/**
 * Every extension the caps tool measures (scripts/code-caps/files.ts). A narrower list would let a .tsx or .cjs file
 * skip every rule, because `--no-warn-ignored` hides the "no matching configuration" notice. A file that no tsconfig
 * project includes fails with a project-service parse error, which is the point: add it to a project.
 */
const files = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

/**
 * The security plugin ships its recommended set as `warn`; one severity keeps the gate easy to read.
 * @type {[string, 'error'][]}
 */
const securityEntries = Object.keys(security.configs.recommended.rules ?? {}).map((name) => [name, 'error']);

export default defineConfig([
  // Build and report output (all git-ignored).
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/build/',
    '**/coverage/',
    '**/reports/',
    '**/.vitest/',
    '**/.stryker-tmp/',
    '**/playwright-report/',
    '**/test-results/',
    '.yarn/',
  ]),
  {
    files,
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      sonarjs.configs.recommended,
    ],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // Numbers cannot turn into "[object Object]"; any, boolean, nullish, regexp and never stay errors.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Not part of strictTypeChecked, and Biome's counterpart is still nursery: a new union member must break the build.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Size and complexity caps: they mirror CAPS in scripts/code-caps/types.ts. Change both together. One known
      // difference: max-params also counts a typed `this` parameter, which the caps tool treats as free. ESLint is the
      // stricter side, and @typescript-eslint/max-params would not align them (it only skips `this: void`).
      complexity: ['error', 10],
      'max-lines': ['error', { max: 500, ...counting }],
      'max-lines-per-function': ['error', { max: 50, ...counting }],
      'max-params': ['error', 4],
      'max-depth': ['error', 4],
      // Biome's noExcessiveCognitiveComplexity (error, 10) owns this one.
      'sonarjs/cognitive-complexity': 'off',
    },
  },
  {
    files,
    plugins: security.configs.recommended.plugins ?? {},
    rules: Object.fromEntries(securityEntries),
  },
  { files, ...noUnsanitized.configs.recommended },
]);
