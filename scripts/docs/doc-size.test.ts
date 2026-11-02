// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { statSync } from 'node:fs';
import { expect, test } from 'vitest';

/** The failure message: which file, its size and by how much it exceeds the ceiling (negative while it fits). */
function sizeMessage(file: string, bytes: number, ceiling: number): string {
  return `${file} is ${bytes} bytes, ${bytes - ceiling} over its ceiling of ${ceiling} bytes: move detail into docs/`;
}

test('README.md stays a landing page of at most 10240 bytes', () => {
  const bytes = statSync('README.md').size;
  expect(bytes, sizeMessage('README.md', bytes, 10_240)).toBeLessThanOrEqual(10_240);
});

test('CLAUDE.md stays a short operating contract of at most 6144 bytes', () => {
  const bytes = statSync('CLAUDE.md').size;
  expect(bytes, sizeMessage('CLAUDE.md', bytes, 6_144)).toBeLessThanOrEqual(6_144);
});
