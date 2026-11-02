// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { dependabotProblems } from './dependabot.ts';

// E20-S09: the lockstep groups of dependabot.yml, in good and bad orders.

const PLAYWRIGHT = '      playwright:\n        patterns: ["@playwright/test"]';
const STRYKER = '      stryker:\n        patterns: ["@stryker-mutator/*"]';
const MEMLAB = '      memlab:\n        patterns: ["memlab", "@memlab/api"]';
const CATCH_ALL = '      dev-tooling:\n        patterns: ["*"]\n        update-types: ["minor", "patch"]';

/** A dependabot.yml with an npm entry whose groups are the given blocks. */
function config(...groups: readonly string[]): string {
  return [
    'version: 2',
    'updates:',
    '  - package-ecosystem: npm',
    '    directory: /',
    '    groups:',
    ...groups,
    '',
  ].join('\n');
}

const MISSING = {
  playwright: 'dependabot.yml: no npm group holds @playwright/test together',
  stryker: 'dependabot.yml: no npm group holds @stryker-mutator/* together',
  memlab: 'dependabot.yml: no npm group holds memlab and @memlab/api together',
};

test('the three lockstep groups above a catch-all group are clean', () => {
  expect(dependabotProblems(config(PLAYWRIGHT, STRYKER, MEMLAB, CATCH_ALL))).toEqual([]);
});

test('a catch-all group that is listed last, and none at all, are both fine', () => {
  expect(dependabotProblems(config(PLAYWRIGHT, STRYKER, MEMLAB))).toEqual([]);
});

test.each([
  ['playwright', config(STRYKER, MEMLAB, CATCH_ALL), [MISSING.playwright]],
  ['stryker', config(PLAYWRIGHT, MEMLAB, CATCH_ALL), [MISSING.stryker]],
  ['memlab', config(PLAYWRIGHT, STRYKER, CATCH_ALL), [MISSING.memlab]],
  ['all of them', config(CATCH_ALL), [MISSING.playwright, MISSING.stryker, MISSING.memlab]],
])('a missing %s group is reported', (_label, text, expected) => {
  expect(dependabotProblems(text)).toEqual(expected);
});

test.each([
  ['memlab alone', '      memlab:\n        patterns: ["memlab"]'],
  ['@memlab/api alone', '      memlab:\n        patterns: ["@memlab/api"]'],
  [
    'memlab and @memlab/api in two groups',
    '      memlab:\n        patterns: ["memlab"]\n      memlab-api:\n        patterns: ["@memlab/api"]',
  ],
  ['a group with no patterns', '      memlab:\n        dependency-type: development'],
])('%s does not hold memlab and @memlab/api together', (_label, block) => {
  expect(dependabotProblems(config(PLAYWRIGHT, STRYKER, block))).toEqual([MISSING.memlab]);
});

test('a lockstep group listed after a group that matches everything would never receive its packages', () => {
  expect(dependabotProblems(config(CATCH_ALL, PLAYWRIGHT, STRYKER, MEMLAB))).toEqual([
    'dependabot.yml: the group "playwright" (@playwright/test) comes after a group that matches "*", which would take its packages',
    'dependabot.yml: the group "stryker" (@stryker-mutator/*) comes after a group that matches "*", which would take its packages',
    'dependabot.yml: the group "memlab" (memlab and @memlab/api) comes after a group that matches "*", which would take its packages',
  ]);
});

test('only the groups after the catch-all are reported', () => {
  expect(dependabotProblems(config(PLAYWRIGHT, CATCH_ALL, STRYKER, MEMLAB))).toEqual([
    'dependabot.yml: the group "stryker" (@stryker-mutator/*) comes after a group that matches "*", which would take its packages',
    'dependabot.yml: the group "memlab" (memlab and @memlab/api) comes after a group that matches "*", which would take its packages',
  ]);
});

test('a lockstep group that restricts update-types would let a major bump split the packages', () => {
  const narrowed =
    '      playwright:\n        patterns: ["@playwright/test"]\n        update-types: ["minor", "patch"]';
  expect(dependabotProblems(config(narrowed, STRYKER, MEMLAB))).toEqual([
    'dependabot.yml: the group "playwright" (@playwright/test) must not restrict update-types, or a major bump would split the lockstep',
  ]);
});

test('a group that holds a lockstep pattern among others still counts', () => {
  const wide =
    '      toolchain:\n        patterns: ["@playwright/test", "@stryker-mutator/*", "memlab", "@memlab/api"]';
  expect(dependabotProblems(config(wide, CATCH_ALL))).toEqual([]);
});

test.each([
  ['no npm entry', 'version: 2\nupdates:\n  - package-ecosystem: github-actions\n    directory: /\n'],
  ['no updates', 'version: 2\nupdates: []\n'],
])('%s is reported', (_label, text) => {
  expect(dependabotProblems(text)).toEqual(['dependabot.yml: has no npm update entry']);
});

test('an npm entry with no groups misses all three', () => {
  const text = 'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n';
  expect(dependabotProblems(text)).toEqual([MISSING.playwright, MISSING.stryker, MISSING.memlab]);
});

test('groups of the github-actions entry do not stand in for the npm ones', () => {
  const text = [
    'version: 2',
    'updates:',
    '  - package-ecosystem: github-actions',
    '    groups:',
    PLAYWRIGHT,
    '  - package-ecosystem: npm',
    '    groups:',
    CATCH_ALL,
    '',
  ].join('\n');
  expect(dependabotProblems(text)).toEqual([MISSING.playwright, MISSING.stryker, MISSING.memlab]);
});

test.each([['not: [valid'], ['version: 2\n'], ['updates: 5\n']])('input %j is rejected, not passed', (text) => {
  expect(() => dependabotProblems(text)).toThrow();
});
