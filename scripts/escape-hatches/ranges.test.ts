// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { scanSource } from './scan.ts';

// E20-S16: Vitest 5 (ast-v8-to-istanbul) hides lines from the 100% gate for an `ignore start` anywhere on a raw source
// line: after other words in a comment, in a string, in a template literal. The gate must see all of them, and it must
// not mistake the forms Vitest does not honour (a mid-comment `ignore next`, a string holding `ignore next`) for hatches.
// The directive is built from parts below so that this file holds none: the gate scans its own tests.

const START = ['v8', 'ignore', 'start'].join(' ');
const STOP = ['c8', 'ignore', 'stop'].join(' ');
const NEXT = ['v8', 'ignore', 'next'].join(' ');
const MARKED = '-- @preserve the generated table has no logic';
const NEEDS_PRESERVE = '"-- @preserve"';
const NEEDS_REASON = 'a reason after "-- @preserve"';

/** `[line, hatch, missing]` of every finding in `lines`. */
function found(lines: readonly string[]): [number, string, string][] {
  return scanSource('m.ts', `${lines.join('\n')}\n`).map((finding) => [finding.line, finding.hatch, finding.missing]);
}

test.each([
  ['after other words of a line comment', [`// note: ${START}`, 'export const a = 1;'], 1],
  ['after other words of a block comment', [`/* note: ${START} */`, 'export const a = 1;'], 1],
  ['on the second line of a block comment', ['/*', ` * ${START}`, ' */', 'export const a = 1;'], 2],
  ['inside a string', [`export const a = '${START}';`], 1],
  ['inside a template literal', ['export const a = `', START, '`;'], 2],
  ['as the end of a range, in another spelling', ['export const a = 1;', `// ${STOP}`], 2],
  ['next to code on the same line', [`export const a = 1; // ${START}`], 1],
])('a range directive %s is an escape hatch', (_what, lines, line) => {
  expect(found(lines)).toEqual([[line, 'v8 ignore', NEEDS_PRESERVE]]);
});

test.each([
  ['after other words of a line comment', [`// note: ${START} ${MARKED}`]],
  ['after other words of a block comment', [`/* note: ${START} ${MARKED} */`]],
  ['inside a string', [`export const a = '${START} ${MARKED}';`]],
  ['inside a template literal', ['export const a = `', `${START} ${MARKED}`, '`;']],
  [
    'in a block comment whose reason is on the next line',
    ['/*', ` * ${START} -- @preserve`, ' * the generated table', ' */'],
  ],
])('a range directive with the marker and a reason is justified: %s', (_what, lines) => {
  expect(found(lines)).toEqual([]);
});

test.each([
  ['a marker without a reason', `/* ${START} -- @preserve */`],
  ['a short reason before the end of the comment', `/* ${START} -- @preserve nope */ export const a = 1;`],
  ['a short reason in a string', `export const a = '${START} -- @preserve nope';`],
])('a range directive with %s lacks a reason', (_what, line) => {
  expect(found([line])).toEqual([[1, 'v8 ignore', NEEDS_REASON]]);
});

test.each([
  ['a one-line block comment', [`/* ${START} */`]],
  ['a line comment', [`// ${STOP}`]],
  ['a comment of several lines that starts with it', [`/* ${START}`, ' * generated', ' */']],
])('a comment that starts with a range directive is reported once, on its line: %s', (_what, lines) => {
  expect(found(lines)).toEqual([[1, 'v8 ignore', NEEDS_PRESERVE]]);
});

test('Vitest honours only the first directive of a line, and so does the gate: one finding per line', () => {
  expect(found([`// ${START} and ${STOP}`])).toEqual([[1, 'v8 ignore', NEEDS_PRESERVE]]);
});

test.each([
  ['after other words of a line comment', `// note: ${NEXT}`],
  ['after other words of a block comment', `/* note: ${NEXT} */`],
  ['inside a string', `export const a = '/* ${NEXT} */';`],
  ['inside a template literal', `export const a = \`// ${NEXT}\`;`],
  ['a word that only starts like the directive', `// the ${START}ed lines are listed below`],
])('a form Vitest does not honour is not a hatch: %s', (_what, line) => {
  expect(found([line, 'export const b = 2;'])).toEqual([]);
});
