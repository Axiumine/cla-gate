// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Linter } from 'eslint';

// The layering rules of docs/architecture.md ("Layering" and "Rules"), as ESLint flat-config blocks that
// eslint.config.mjs appends. They live here, in a module Vitest can import, so that scripts/eslint-layers.test.ts
// proves with real snippets what each layer may and may not import. A later block REPLACES a rule for its files, so
// every block repeats what it inherits.

/**
 * A regular expression for a RELATIVE specifier with a path segment named `directory`: `../web`, `./web/x`,
 * `../../server/app.ts`. It does not match a package such as `node:stream/web` or `react-dom/server`, which a glob on the
 * bare name would. esquery (ESLint selectors) cannot hold a slash inside a regex literal, so `\x2f` stands for it.
 */
const into = (directory: string): string => String.raw`^\.{1,2}\x2f(?:[^\x2f]+\x2f)*${directory}(?:\x2f|$)`;

const noServer = 'src/shared and src/web must not import src/server.';
const noWeb = 'src/server and src/shared must not import src/web.';
const dynamic = 'Dynamic import() needs a string literal so the layering can be checked.';
const sharedAndWeb = 'src/shared and src/web must not import src/server (dynamic import included).';

/** `no-restricted-imports` for static imports and re-exports (ESLint ignores `import()`; see {@link restrictedSyntax}). */
const restrictImports = (...patterns: { regex: string; message: string }[]): Linter.RulesRecord => ({
  'no-restricted-imports': ['error', { patterns }],
});

/** Dynamic `import()` is an expression, not a declaration, so it needs `no-restricted-syntax` selectors of its own. */
const restrictedSyntax = (...selectors: { selector: string; message: string }[]): Linter.RulesRecord => ({
  'no-restricted-syntax': ['error', ...selectors],
});

const nonLiteralImport = { selector: "ImportExpression[source.type!='Literal']", message: dynamic };
const dynamicInto = (directory: string, message: string) => ({
  selector: `ImportExpression[source.value=/${into(directory)}/]`,
  message,
});

/**
 * The `no-restricted-syntax` selectors that keep src/web off src/server. A block for some src/web files that sets selectors
 * of its own (scripts/web/eslint-config.ts) must repeat these, because a later block replaces the rule instead of adding to it.
 */
export const webLayerSelectors = [nonLiteralImport, dynamicInto('server', sharedAndWeb)];

/**
 * Everything the pure domain layer may import: its own files (no `..` anywhere), src/shared, and zod. Any other
 * specifier matches this "not allowed" expression: Node built-ins (`node:fs`, `node:dns/promises`, `node:sqlite`), I/O
 * libraries, and every other layer (`../app.ts`, `../boot.ts`, `../config`, `../adapters`, `../services`). An allow-list
 * cannot be sidestepped by an I/O module nobody thought of. `extra` adds bare package names (a regex fragment that
 * starts with `|`); only the domain tests use it, for the test runner.
 */
const outsideDomainExcept = (extra: string): string =>
  String.raw`^(?!(?:\./(?!.*\.\.)|(?:\.\./)+shared/(?!.*\.\.)|zod(?:/|$)${extra}))`;

const outsideDomain = outsideDomainExcept('');
const outsideDomainTest = outsideDomainExcept('|vitest$');

/** Globals that reach the outside world, or the global object they hang from, without an import. */
const impureGlobals = ['fetch', 'process', 'require', 'WebSocket', 'XMLHttpRequest', 'EventSource'];

/** Clocks and randomness: the same facts must always give the same answer (E08-S01). Tests inject a seeded generator. */
const nondeterministicGlobals = ['Date', 'Temporal', 'performance', 'crypto'];

/** The rules of src/server/domain; a test file differs only in the one extra package it may import. */
const domainRules = (importPattern: string): Linter.RulesRecord => ({
  ...restrictImports({
    regex: importPattern,
    message: 'src/server/domain is pure: it imports only its own files, src/shared and zod.',
  }),
  ...restrictedSyntax(
    { selector: 'ImportExpression', message: 'src/server/domain is pure: no dynamic import().' },
    {
      selector: 'MemberExpression[object.name=/^(?:globalThis|global|self|window)$/]',
      message: 'src/server/domain is pure: it does not reach the outside world through the global object.',
    },
  ),
  'no-restricted-globals': [
    'error',
    ...impureGlobals.map((name) => ({ name, message: 'src/server/domain is pure: no I/O and no process state.' })),
    ...nondeterministicGlobals.map((name) => ({
      name,
      message: 'src/server/domain is pure: no clock and no randomness, the same facts give the same answer.',
    })),
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'src/server/domain is pure: no randomness.' },
  ],
});

export const layerConfigs: Linter.Config[] = [
  {
    files: ['src/shared/**'],
    rules: {
      ...restrictImports({ regex: into('server'), message: noServer }, { regex: into('web'), message: noWeb }),
      ...restrictedSyntax(nonLiteralImport, dynamicInto('server', noServer), dynamicInto('web', noWeb)),
    },
  },
  {
    files: ['src/web/**'],
    rules: {
      ...restrictImports({ regex: into('server'), message: sharedAndWeb }),
      ...restrictedSyntax(...webLayerSelectors),
    },
  },
  {
    files: ['src/server/**'],
    rules: {
      ...restrictImports({ regex: into('web'), message: noWeb }),
      ...restrictedSyntax(nonLiteralImport, dynamicInto('web', noWeb)),
    },
  },
  {
    // Decision logic only. Must come after src/server/**.
    files: ['src/server/domain/**'],
    rules: domainRules(outsideDomain),
  },
  {
    // The tests next to the domain code may also import the test runner, and nothing else beyond the domain rules.
    files: ['src/server/domain/**/*.test.ts'],
    rules: domainRules(outsideDomainTest),
  },
];
