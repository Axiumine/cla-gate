// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { checkTrivyIgnore, dayNumber, dayOf, MAX_IGNORE_DAYS } from './ignore-file.ts';

// E20-S02: the rules for .trivyignore. Entry lines are judged against a commit date and a "today" that the tests choose.

const COMMITTED = new Date('2026-11-02T10:00:00Z');
const TODAY = new Date('2026-11-05T08:00:00Z');
const REASON = '# fixed upstream, waiting for the base image';

/** Violations of `text`, every line committed on COMMITTED and "today" being TODAY unless given. */
function check(text: string, committedOn: (line: number) => Date = () => COMMITTED, today: Date = TODAY): string[] {
  return checkTrivyIgnore(text, committedOn, today);
}

test.each([
  ['an empty file', ''],
  ['only a newline', '\n'],
  ['only comments and blank lines', '# nothing to ignore yet\n\n# still nothing\n'],
  ['one entry with a reason and an expiry inside 90 days', `${REASON}\nCVE-2026-1234 exp:2026-12-31\n`],
  ['an entry with Windows line endings', `${REASON}\r\nCVE-2026-1234 exp:2026-12-31\r\n`],
  ['a secret rule id', '# test fixture, not a real key\ngithub-pat exp:2026-12-01\n'],
  [
    'two entries, each with its own reason',
    `${REASON}\nCVE-2026-1 exp:2026-12-01\n# other reason\nAVD-DS-0002 exp:2026-12-02\n`,
  ],
  ['an expiry exactly 90 days after the commit day', `${REASON}\nCVE-2026-1234 exp:2027-01-31\n`],
])('accepts %s', (_name, text) => {
  expect(check(text)).toEqual([]);
});

test('an entry without a comment line directly above it is rejected, with its line number', () => {
  expect(check('CVE-2026-1234 exp:2026-12-31\n')).toEqual([
    '.trivyignore:1: no reason: put a comment line directly above the entry',
  ]);
});

test.each([
  ['a blank line between the comment and the entry', `${REASON}\n\nCVE-2026-1234 exp:2026-12-31\n`],
  ['an empty comment', '#\nCVE-2026-1234 exp:2026-12-31\n'],
  ['a comment of only spaces', '#    \nCVE-2026-1234 exp:2026-12-31\n'],
  [
    'a second entry that shares the comment of the first',
    `${REASON}\nCVE-2026-1 exp:2026-12-01\nCVE-2026-2 exp:2026-12-01\n`,
  ],
])('rejects %s', (_name, text) => {
  const problems = check(text);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(/^\.trivyignore:\d+: no reason/);
});

test.each([
  ['no expiry at all', 'CVE-2026-1234', 'no expiry (add exp:YYYY-MM-DD)'],
  ['two expiries', 'CVE-2026-1234 exp:2026-12-01 exp:2026-12-02', 'more than one expiry'],
  ['an empty expiry', 'CVE-2026-1234 exp:', 'the expiry is not a calendar day written YYYY-MM-DD: exp:'],
  ['a month 13', 'CVE-2026-1234 exp:2026-13-01', 'the expiry is not a calendar day written YYYY-MM-DD: exp:2026-13-01'],
  [
    'the 30th of February',
    'CVE-2026-1234 exp:2026-02-30',
    'the expiry is not a calendar day written YYYY-MM-DD: exp:2026-02-30',
  ],
  [
    'a two digit year',
    'CVE-2026-1234 exp:26-12-01',
    'the expiry is not a calendar day written YYYY-MM-DD: exp:26-12-01',
  ],
  [
    'a slash date',
    'CVE-2026-1234 exp:2026/12/01',
    'the expiry is not a calendar day written YYYY-MM-DD: exp:2026/12/01',
  ],
  ['text after the id that is not an expiry', 'CVE-2026-1234 forever', 'unexpected text after the id: forever'],
  ['text next to a valid expiry', 'CVE-2026-1234 exp:2026-12-01 later', 'unexpected text after the id: later'],
])('rejects %s', (_name, entry, problem) => {
  expect(check(`${REASON}\n${entry}\n`)).toEqual([`.trivyignore:2: ${problem}`]);
});

test.each([
  ['a string with a space-free symbol', '!!!'],
  ['a path', '/etc/passwd'],
  ['a leading dash', '-CVE-1'],
])('rejects an id that is %s', (_name, id) => {
  expect(check(`${REASON}\n${id} exp:2026-12-01\n`)).toEqual([
    `.trivyignore:2: ${id} is not an identifier (a CVE, an AVD or a secret rule id)`,
  ]);
});

test('an entry whose expiry day is today or earlier is expired: Trivy stops honouring it on that day', () => {
  const expired = (day: string) => [
    `.trivyignore:2: expired (exp:${day}): Trivy stops honouring an entry on its expiry day, remove it or fix the cause`,
  ];
  expect(check(`${REASON}\nCVE-2026-1 exp:2026-11-04\n`)).toEqual(expired('2026-11-04'));
  expect(check(`${REASON}\nCVE-2026-1 exp:2026-11-05\n`)).toEqual(expired('2026-11-05'));
  expect(check(`${REASON}\nCVE-2026-1 exp:2026-11-06\n`)).toEqual([]);
});

test('the day of "today" is the UTC day, so the last second of a day still counts as that day', () => {
  const late = new Date('2026-11-05T23:59:59Z');
  expect(check(`${REASON}\nCVE-2026-1 exp:2026-11-05\n`, () => COMMITTED, late)).toHaveLength(1);
  expect(check(`${REASON}\nCVE-2026-1 exp:2026-11-06\n`, () => COMMITTED, late)).toEqual([]);
});

test('an expiry more than 90 days after the commit day is rejected, 90 days is the most', () => {
  expect(MAX_IGNORE_DAYS).toBe(90);
  expect(check(`${REASON}\nCVE-2026-1 exp:2027-01-31\n`)).toEqual([]);
  expect(check(`${REASON}\nCVE-2026-1 exp:2027-02-01\n`)).toEqual([
    '.trivyignore:2: expires more than 90 days after the day it was committed (exp:2027-02-01)',
  ]);
});

test('each entry is judged by the day its own line was committed', () => {
  const text = `${REASON}\nCVE-2026-1 exp:2027-01-31\n# later reason\nCVE-2026-2 exp:2027-03-01\n`;
  const older = new Date('2026-11-02T00:00:00Z');
  const newer = new Date('2026-12-01T00:00:00Z');
  // Line 2 was committed on 2026-11-02 (90 days to 2027-01-31); line 4 on 2026-12-01 (90 days to 2027-03-01).
  expect(check(text, (line) => (line <= 2 ? older : newer))).toEqual([]);
  // If the newer line were committed on the older day, its expiry would be too far away.
  expect(check(text, () => older)).toEqual([
    '.trivyignore:4: expires more than 90 days after the day it was committed (exp:2027-03-01)',
  ]);
});

test('every problem of an entry is reported, in a fixed order, with the line number', () => {
  expect(check('!!!\n')).toEqual([
    '.trivyignore:1: !!! is not an identifier (a CVE, an AVD or a secret rule id)',
    '.trivyignore:1: no reason: put a comment line directly above the entry',
    '.trivyignore:1: no expiry (add exp:YYYY-MM-DD)',
  ]);
});

test('dayNumber accepts real calendar days only and counts days since 1970-01-01', () => {
  expect(dayNumber('1970-01-01')).toBe(0);
  expect(dayNumber('1970-01-02')).toBe(1);
  expect(dayNumber('2028-02-29')).toBe(dayOf(new Date('2028-02-29T12:00:00Z')));
  expect(dayNumber('2027-02-29')).toBeUndefined();
  expect(dayNumber('2026-00-10')).toBeUndefined();
  expect(dayNumber('2026-1-10')).toBeUndefined();
  expect(dayNumber('')).toBeUndefined();
});
