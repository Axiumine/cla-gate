// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { compareNames } from '../code-caps/types.ts';
import { scenarioFiles, scenarioName, scenarioOf } from './scenario.ts';
import { scenarioModule } from './test-support.ts';

// E20-S07: which files the wrapper runs, and what a file must default-export.

test('the name of a scenario is its file name without the directory and the extension', () => {
  expect(scenarioName('/repo/tests/leaks/scenarios/canary-navigation.ts')).toBe('canary-navigation');
  expect(scenarioName('plain.ts')).toBe('plain');
});

test('the scenario of a module is its default export with url, action and back', () => {
  const loaded = scenarioModule('x');
  const scenario = scenarioOf(loaded, 'x.ts');
  expect(scenario.url).toBe(loaded.default.url);
  expect(scenario.action).toBe(loaded.default.action);
  expect(scenario.back).toBe(loaded.default.back);
  expect(Object.keys(scenario).sort(compareNames)).toEqual(['action', 'back', 'url']);
});

const FN = () => 'x';
test.each([
  ['nothing at all', undefined],
  ['null', null],
  ['a module without a default export', { other: { url: FN, action: FN, back: FN } }],
  ['a default that is not an object', { default: 'scenario' }],
  ['a null default', { default: null }],
  ['a scenario without url', { default: { action: FN, back: FN } }],
  ['a scenario without action', { default: { url: FN, back: FN } }],
  ['a scenario without back', { default: { url: FN, action: FN } }],
  ['a url that is a string', { default: { url: 'clean.html', action: FN, back: FN } }],
  ['an action that is an object', { default: { url: FN, action: {}, back: FN } }],
])('%s is refused with a message that names the file', (_label, loaded) => {
  expect(() => scenarioOf(loaded, '/s/bad.ts')).toThrow(
    '/s/bad.ts must default-export { url, action, back }, each a function',
  );
});

test('without arguments every .ts file of the directory is a scenario, in code point order, and nothing else', () => {
  const places = { cwd: '/work', directory: '/repo/scenarios' };
  const listing = ['b.ts', 'README.md', 'a.ts', 'types.d.ts', 'B.ts', 'c.mts', 'dir'];
  expect(scenarioFiles([], places, () => listing)).toEqual([
    '/repo/scenarios/B.ts',
    '/repo/scenarios/a.ts',
    '/repo/scenarios/b.ts',
  ]);
});

test('the directory is listed once, by the path the caller gave', () => {
  const asked: string[] = [];
  scenarioFiles([], { cwd: '/work', directory: '/repo/scenarios' }, (directory) => {
    asked.push(directory);
    return [];
  });
  expect(asked).toEqual(['/repo/scenarios']);
});

test('files named on the command line replace the directory: relative ones resolve against the working directory', () => {
  const places = { cwd: '/work', directory: '/repo/scenarios' };
  const listed: string[] = [];
  const files = scenarioFiles(['tests/x.ts', '/abs/y.ts', '../z.ts'], places, (directory) => {
    listed.push(directory);
    return ['never.ts'];
  });
  expect(files).toEqual(['/work/tests/x.ts', '/abs/y.ts', '/z.ts']);
  expect(listed).toEqual([]);
});
