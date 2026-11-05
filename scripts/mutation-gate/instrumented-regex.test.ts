// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { filesTheGateMutates, invalidRegexMutants, mutantsOf, originalText } from './test-support.ts';

// The initial test run of a shard loads the instrumented modules, and an instrumented module holds every mutant of its file.
// A regular expression literal with the `u` or `v` flag that has a mutant the engine rejects (`\v` becomes `\V`) is therefore a
// SyntaxError at load: the tests of every shard that reaches the file fail before a mutant is tried, and the shard is lost
// (the nightly run of 2026-11-04, `root-domain-ports`: `LINE_BREAK` in domain/reporting/encode.ts). Stryker's own instrumenter
// makes the mutants here, over every file the gate mutates, and each regular expression mutant has to compile. A literal that fails
// is written another way (`\cK` for the vertical tab) and not suppressed.

const mutant = (replacement: string, mutatorName = 'Regex') => ({
  id: '1',
  fileName: 'src/server/a.ts',
  mutatorName,
  replacement,
  location: { start: { line: 6, column: 2 }, end: { line: 6, column: 20 } },
});

test('a regular expression mutant that does not compile is reported with its file, line, text and the engine message', () => {
  expect(invalidRegexMutants([mutant(String.raw`/[\V]/gu`)])).toEqual([
    `src/server/a.ts:7: /[\\V]/gu: SyntaxError: Invalid regular expression: /[\\V]/gu: Invalid escape`,
  ]);
  expect(invalidRegexMutants([mutant('/(/')])).toHaveLength(1);
});

test('a mutant that compiles, one of another mutator and a pattern given as a string are not reported', () => {
  expect(invalidRegexMutants([mutant(String.raw`/[\D]/gu`), mutant('/a|b/')])).toEqual([]);
  expect(invalidRegexMutants([mutant('/(/', 'ConditionalExpression')])).toEqual([]);
  expect(invalidRegexMutants([mutant('"("')])).toEqual([]);
});

test('Stryker makes mutants of a regular expression literal, written as a literal, from a source it is given', async () => {
  const mutants = await mutantsOf([{ name: 'a.ts', content: 'export const R = /[\\d]+|a/u;\n' }]);
  const regexes = mutants.filter(({ mutatorName }) => mutatorName === 'Regex');
  expect(regexes.length).toBeGreaterThan(2);
  expect(regexes.every(({ replacement }) => /^\/.+\/u$/.test(replacement))).toBe(true);
  expect(regexes.map(({ replacement }) => replacement)).toContain(String.raw`/[\D]+|a/u`);
  expect(invalidRegexMutants(mutants)).toEqual([]);
});

test('no regular expression of the files the gate mutates has a mutant that fails to compile', async () => {
  const files = await filesTheGateMutates();
  expect(files).toEqual(
    expect.arrayContaining(['src/server/domain/reporting/encode.ts', 'scripts/check-code-caps.ts']),
  );
  expect(files.length).toBeGreaterThan(500);
  const mutants = await mutantsOf(files.map((name) => ({ name, content: originalText(name) })));
  // The guard is not empty: the files hold many regular expression literals, those of encode.ts among them.
  const regexes = mutants.filter(({ mutatorName }) => mutatorName === 'Regex');
  expect(regexes.length).toBeGreaterThan(100);
  expect(regexes.filter(({ fileName }) => fileName === 'src/server/domain/reporting/encode.ts').length).toBeGreaterThan(
    5,
  );
  expect(invalidRegexMutants(mutants)).toEqual([]);
});
