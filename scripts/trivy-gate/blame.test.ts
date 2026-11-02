// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { checkTrivyIgnoreFile, committedDates, IGNORE_FILE } from './blame.ts';
import { commitAt, plusDays } from './test-support.ts';

// E20-S02: the age of each .trivyignore line comes from `git blame`, in real scratch repositories with chosen dates.

const FIRST = '2026-03-01T12:00:00Z';
const REASON = '# fixed upstream, waiting for the base image';

/** A repository whose .trivyignore was written in several commits: `commits` is [iso date, whole file text] in order. */
function history(commits: readonly (readonly [string, string])[]): string {
  const root = tempDir();
  for (const [iso, text] of commits) {
    makeRepo(root, { [IGNORE_FILE]: text, 'README.txt': iso });
    commitAt(root, iso, `at ${iso}`);
  }
  return root;
}

test('every line reports the moment of the commit that wrote it', () => {
  const second = plusDays(FIRST, 30);
  const root = history([
    [FIRST, `${REASON}\nCVE-2026-1 exp:2026-04-01\n`],
    [second, `${REASON}\nCVE-2026-1 exp:2026-04-01\n# second reason\nCVE-2026-2 exp:2026-05-01\n`],
  ]);
  const dates = committedDates(root, IGNORE_FILE);
  expect([...dates.entries()].map(([line, date]) => [line, date.toISOString()])).toEqual([
    [1, '2026-03-01T12:00:00.000Z'],
    [2, '2026-03-01T12:00:00.000Z'],
    [3, '2026-03-31T12:00:00.000Z'],
    [4, '2026-03-31T12:00:00.000Z'],
  ]);
});

test('a line that is not committed yet reports the present moment', () => {
  const root = history([[FIRST, `${REASON}\nCVE-2026-1 exp:2026-04-01\n`]]);
  makeRepo(root, { [IGNORE_FILE]: `${REASON}\nCVE-2026-1 exp:2026-04-01\n# new\nCVE-2026-9 exp:2026-04-02\n` });
  const before = Date.now();
  const dates = committedDates(root, IGNORE_FILE);
  expect(dates.get(1)?.toISOString()).toBe('2026-03-01T12:00:00.000Z');
  expect(dates.get(4)?.getTime()).toBeGreaterThanOrEqual(before - 5000);
});

test('git cannot say for a file that is not tracked or a directory that is not a repository: no dates', () => {
  const root = history([[FIRST, '# nothing\n']]);
  makeRepo(root, { 'other.txt': 'new\n' });
  expect(committedDates(root, 'other.txt').size).toBe(0);
  expect(committedDates(tempDir(), IGNORE_FILE).size).toBe(0);
});

test('without a .trivyignore the check passes: the file is created only when the first ignore is needed', () => {
  const root = tempDir();
  makeRepo(root, { 'README.txt': 'x\n' });
  commitAt(root, FIRST, 'first');
  expect(checkTrivyIgnoreFile(root, new Date(FIRST))).toEqual([]);
  expect(checkTrivyIgnoreFile(tempDir(), new Date(FIRST))).toEqual([]);
});

test('a committed file with a reason and an expiry inside 90 days of its commit passes', () => {
  const root = history([[FIRST, `${REASON}\nCVE-2026-1 exp:2026-05-01\n`]]);
  expect(checkTrivyIgnoreFile(root, new Date(plusDays(FIRST, 10)))).toEqual([]);
});

test('an entry is measured from the commit of its own line: a later commit does not make an old entry younger', () => {
  // Day 0 is 2026-03-01 and day 80 is 2026-05-20: 90 days after day 0 is 2026-05-30, after day 80 it is 2026-08-18.
  const rewritten = history([
    [FIRST, `${REASON}\nCVE-2026-1 exp:2026-05-30\n`],
    [plusDays(FIRST, 80), `${REASON}\nCVE-2026-1 exp:2026-08-18\n`],
  ]);
  expect(checkTrivyIgnoreFile(rewritten, new Date(plusDays(FIRST, 81)))).toEqual([]);
  const stale = history([
    [FIRST, `${REASON}\nCVE-2026-1 exp:2026-08-18\n`],
    [plusDays(FIRST, 80), `${REASON}\nCVE-2026-1 exp:2026-08-18\n# other\nCVE-2026-2 exp:2026-08-10\n`],
  ]);
  expect(checkTrivyIgnoreFile(stale, new Date(plusDays(FIRST, 81)))).toEqual([
    '.trivyignore:2: expires more than 90 days after the day it was committed (exp:2026-08-18)',
  ]);
});

test('an expired entry fails the check', () => {
  const root = history([[FIRST, `${REASON}\nCVE-2026-1 exp:2026-04-01\n`]]);
  expect(checkTrivyIgnoreFile(root, new Date('2026-04-01T00:00:00Z'))).toEqual([
    '.trivyignore:2: expired (exp:2026-04-01): Trivy stops honouring an entry on its expiry day, remove it or fix the cause',
  ]);
});

test('an entry without a reason or an expiry fails the check', () => {
  const root = history([[FIRST, 'CVE-2026-1\n']]);
  expect(checkTrivyIgnoreFile(root, new Date(FIRST))).toEqual([
    '.trivyignore:1: no reason: put a comment line directly above the entry',
    '.trivyignore:1: no expiry (add exp:YYYY-MM-DD)',
  ]);
});

test('a file that git does not know yet counts as written now, so its expiry is measured from today', () => {
  const root = tempDir();
  makeRepo(root, { [IGNORE_FILE]: `${REASON}\nCVE-2026-1 exp:2026-05-30\n` });
  expect(checkTrivyIgnoreFile(root, new Date(FIRST))).toEqual([]);
  makeRepo(root, { [IGNORE_FILE]: `${REASON}\nCVE-2026-1 exp:2026-06-01\n` });
  expect(checkTrivyIgnoreFile(root, new Date(FIRST))).toEqual([
    '.trivyignore:2: expires more than 90 days after the day it was committed (exp:2026-06-01)',
  ]);
});
