// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { formatVersion, nextVersion } from './version-number.ts';

// E18-S05: how a version number is written, and the number a publish would give (display only: the server numbers the version).

test('a version is written major.minor', () => {
  expect(formatVersion({ major: 2, minor: 10 })).toBe('2.10');
});

test.each([
  [{ major: 1, minor: 0 }, 'minor', '1.1'],
  [{ major: 2, minor: 4 }, 'minor', '2.5'],
  [{ major: 1, minor: 3 }, 'major', '2.0'],
  [{ major: 9, minor: 0 }, 'major', '10.0'],
] as const)('after %o a %s publish is %s', (active, bump, expected) => {
  expect(formatVersion(nextVersion(active, bump))).toBe(expected);
});

test.each(['major', 'minor'] as const)(
  'a document with no version gets 1.0 whichever bump is asked for (%s)',
  (bump) => {
    expect(nextVersion(null, bump)).toEqual({ major: 1, minor: 0 });
  },
);
