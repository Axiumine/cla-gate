// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { escapeHatchConfig } from './eslint-config.ts';

// E20-S16: violating source text goes to ESLint's Linter class together with the real escape-hatch block. No violating
// file exists in the repository, and nothing is excluded from a gate.

const linter = new Linter();

const BAN = '@typescript-eslint/ban-ts-comment';
const DESCRIPTION = '@eslint-community/eslint-comments/require-description';
const UNLIMITED = '@eslint-community/eslint-comments/no-unlimited-disable';
const PAIR = '@eslint-community/eslint-comments/disable-enable-pair';
const UNUSED = 'unused-directive';

/** `[ruleId, severity]` of every message for `code`; an unused directive has no rule id and shows as UNUSED. */
function messages(code: string): [string, number][] {
  const config: Linter.Config[] = [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    escapeHatchConfig,
    // A stand-in for any rule a directive can switch off.
    { files: ['**/*.ts'], rules: { 'no-debugger': 'error' } },
  ];
  return linter
    .verify(code, config, { filename: 'src/server/example.ts' })
    .map((message) => [message.ruleId ?? UNUSED, message.severity]);
}

test.each([
  ['a bare @ts-expect-error', '// @ts-expect-error\nexport const a: number = `x`;', BAN],
  ['a @ts-expect-error with a nine-character description', '// @ts-expect-error: 123456\nexport const a = 1;', BAN],
  ['a @ts-ignore with a long description', '// @ts-ignore: this one is explained at length\nexport const a = 1;', BAN],
  ['a bare @ts-ignore', '// @ts-ignore\nexport const a = 1;', BAN],
  [
    'a @ts-nocheck with a long description',
    '// @ts-nocheck: this file is explained at length\nexport const a = 1;',
    BAN,
  ],
  [
    'an eslint-disable-next-line without a description',
    'export const a = 1;\n// eslint-disable-next-line no-debugger\ndebugger;',
    DESCRIPTION,
  ],
  [
    'an eslint-disable-line without a description',
    'export const a = 1;\ndebugger; // eslint-disable-line no-debugger',
    DESCRIPTION,
  ],
  [
    'a block eslint-disable without a description',
    'export const a = 1;\n/* eslint-disable no-debugger */\ndebugger;\n/* eslint-enable no-debugger */',
    DESCRIPTION,
  ],
  [
    'an eslint-disable that names no rule',
    'debugger; // eslint-disable-line -- everything is off on this line',
    UNLIMITED,
  ],
  [
    'an eslint-disable-next-line that names no rule',
    '// eslint-disable-next-line -- everything is off\ndebugger;',
    UNLIMITED,
  ],
  [
    'an eslint-disable that is never enabled',
    'export const a = 1;\n/* eslint-disable no-debugger -- the block ends nowhere */\ndebugger;',
    PAIR,
  ],
  [
    'an eslint-disable directive that suppresses nothing',
    '// eslint-disable-next-line no-debugger -- there is nothing to suppress\nexport const a = 1;',
    UNUSED,
  ],
])('%s is an error', (_what, code, rule) => {
  expect(messages(code)).toContainEqual([rule, 2]);
});

test.each([
  [
    'a @ts-expect-error with a description',
    '// @ts-expect-error: the literal has the wrong type\nexport const a: number = `x`;',
  ],
  [
    'a @ts-expect-error with a description of exactly ten characters',
    '// @ts-expect-error: 1234567890\nexport const a = 1;',
  ],
  ['a @ts-check', '// @ts-check\nexport const a = 1;'],
  [
    'an eslint-disable-next-line with a description',
    '// eslint-disable-next-line no-debugger -- the fixture needs a debugger statement\ndebugger;',
  ],
  [
    'an eslint-disable-line with a description',
    'debugger; // eslint-disable-line no-debugger -- the fixture needs a debugger statement',
  ],
  [
    'a disable at the top of the file, which covers the whole file',
    '/* eslint-disable no-debugger -- the whole file is a debugger fixture */\ndebugger;',
  ],
  [
    'a disable and its enable',
    'export const a = 1;\n/* eslint-disable no-debugger -- paired below */\ndebugger;\n/* eslint-enable no-debugger -- done */',
  ],
  ['a comment about eslint that is not a directive', '// eslint is run by yarn lint\nexport const a = 1;'],
])('%s is accepted', (_what, code) => {
  expect(messages(code)).toEqual([]);
});

// A child process on purpose: ESLint loads eslint.config.mjs and the TypeScript it imports natively, and Vitest's coverage
// would see those copies of the files next to the ones it transforms.
test('the repository ESLint config resolves the rules at error and keeps unused-directive reports on', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/eslint/bin/eslint.js'), '--print-config', 'scripts/check-escape-hatches.ts'],
    { cwd: root, encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  const schema = z.object({
    rules: z.record(z.string(), z.array(z.unknown())),
    linterOptions: z.object({ reportUnusedDisableDirectives: z.unknown() }),
  });
  const parsed = schema.parse(JSON.parse(result.stdout));
  const rules = new Map(Object.entries(parsed.rules));
  expect(rules.get(BAN)).toEqual([
    2,
    {
      'ts-expect-error': 'allow-with-description',
      'ts-ignore': true,
      'ts-nocheck': true,
      'ts-check': false,
      minimumDescriptionLength: 10,
    },
  ]);
  expect(rules.get(DESCRIPTION)).toEqual([2]);
  expect(rules.get(UNLIMITED)).toEqual([2]);
  expect(rules.get(PAIR)).toEqual([2, { allowWholeFile: true }]);
  expect(parsed.linterOptions.reportUnusedDisableDirectives).toBe(2);
});
