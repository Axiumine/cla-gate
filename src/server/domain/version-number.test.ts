// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { nextVersionNumber } from './version-number.ts';

// The numbering of the versions of a CLA document (E12-S04).

test('the first version is 1.0 and only a major bump may make it', () => {
  expect(nextVersionNumber(null, 'major')).toEqual({ ok: true, number: { major: 1, minor: 0 } });
  expect(nextVersionNumber(null, 'minor')).toEqual({ ok: false, rule: 'first_version_must_be_major' });
});

test.each([
  [{ major: 1, minor: 0 }, 'major', { major: 2, minor: 0 }],
  [{ major: 1, minor: 4 }, 'major', { major: 2, minor: 0 }],
  [{ major: 7, minor: 12 }, 'major', { major: 8, minor: 0 }],
  [{ major: 1, minor: 0 }, 'minor', { major: 1, minor: 1 }],
  [{ major: 3, minor: 9 }, 'minor', { major: 3, minor: 10 }],
] as const)('after %j a %s bump gives %j', (active, bump, next) => {
  expect(nextVersionNumber(active, bump)).toEqual({ ok: true, number: next });
});
