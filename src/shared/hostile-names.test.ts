// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from './hostile-names.ts';

// The shape of the shared hostile-name corpus: what a test that imports it may rely on. The tests that use it assert on
// what they render; this file only guards the corpus itself against an edit that would hollow it out.

/** C0 and C1 controls, the line and paragraph separators and the bidi controls: nothing the signing form accepts. */
const NOT_PRINTABLE: readonly (readonly [first: number, last: number])[] = [
  [0x0, 0x1f],
  [0x7f, 0x9f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

function isPrintable(name: string): boolean {
  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (NOT_PRINTABLE.some(([first, last]) => codePoint >= first && codePoint <= last)) {
      return false;
    }
  }
  return true;
}

test.each([
  ['HOSTILE_NAMES', HOSTILE_NAMES],
  ['HOSTILE_CONTROL_NAMES', HOSTILE_CONTROL_NAMES],
])('%s is frozen and has no duplicate and no empty entry', (_name, list) => {
  expect(Object.isFrozen(list)).toBe(true);
  expect(new Set(list).size).toBe(list.length);
  expect(list.every((name) => name !== '')).toBe(true);
});

test.each(HOSTILE_NAMES.map((name) => [name.slice(0, 40), name] as const))(
  'the signing form accepts %j verbatim: printable and well formed',
  (_label, name) => {
    expect(isPrintable(name)).toBe(true);
    expect(name.isWellFormed()).toBe(true);
  },
);

test('the printable list holds the names that attack Markdown, HTML, spreadsheets, mentions and the comment marker', () => {
  expect(HOSTILE_NAMES).toEqual(
    expect.arrayContaining([
      '<script>alert(1)</script>',
      '=HYPERLINK("http://evil.example","x")',
      '@everyone',
      '/recheck',
      'javascript:alert(1)',
      '<!-- cla-platform:license/cla:v1 -->',
    ]),
  );
});

test.each([
  ['a line break', 0x0a],
  ['a NUL', 0x00],
  ['a right-to-left override', 0x202e],
  ['a line separator', 0x2028],
])('the control list holds a name with %s', (_what, codePoint) => {
  expect(HOSTILE_CONTROL_NAMES.some((name) => name.includes(String.fromCodePoint(codePoint)))).toBe(true);
});

test('the control list holds a lone surrogate and a name of ten thousand characters', () => {
  expect(HOSTILE_CONTROL_NAMES.some((name) => !name.isWellFormed())).toBe(true);
  expect(HOSTILE_CONTROL_NAMES.some((name) => name.length === 10_000)).toBe(true);
});
