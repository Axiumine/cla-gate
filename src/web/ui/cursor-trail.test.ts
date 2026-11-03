// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pageNumber, type Step, trailTo } from './cursor-trail.ts';

// E17-S10: the way back through cursor-paged pages. Cursors are opaque: any string is kept and handed back untouched.

const FIRST_TO_C2: Step = { from: undefined, to: 'c2' };
const C2_TO_C3: Step = { from: 'c2', to: 'c3' };
const C3_TO_C4: Step = { from: 'c3', to: 'c4' };

test.each([
  ['no steps', [], 'c2', []],
  ['the first page: nothing leads to it', [FIRST_TO_C2, C2_TO_C3], undefined, []],
  ['the page after one step', [FIRST_TO_C2, C2_TO_C3], 'c2', [FIRST_TO_C2]],
  ['the page after two steps', [FIRST_TO_C2, C2_TO_C3], 'c3', [FIRST_TO_C2, C2_TO_C3]],
  ['a page that was never walked to', [FIRST_TO_C2, C2_TO_C3], 'c9', []],
  [
    'an earlier page after the browser went back: the later steps drop out',
    [FIRST_TO_C2, C2_TO_C3, C3_TO_C4],
    'c3',
    [FIRST_TO_C2, C2_TO_C3],
  ],
] as const)('the trail to %s', (_what, visited, cursor, expected) => {
  expect(trailTo(visited, cursor)).toEqual(expected);
});

test('a cursor that comes up twice is taken at its last step, and a cursor is never looked into', () => {
  const odd = 'ey/J+=?&%00 <b>';
  const loop: readonly Step[] = [
    { from: undefined, to: odd },
    { from: odd, to: 'c3' },
    { from: 'c3', to: odd },
  ];
  expect(trailTo(loop, odd)).toEqual(loop);
});

test.each([
  ['the first page', [], undefined, 1],
  ['the second page', [FIRST_TO_C2], 'c2', 2],
  ['the third page', [FIRST_TO_C2, C2_TO_C3], 'c3', 3],
  ['a later page the pager did not walk to: it cannot count', [], 'c3', undefined],
  ['a later page counted from where the pager came in: it cannot count', [C2_TO_C3], 'c3', undefined],
] as const)('the number of %s is %s', (_what, trail, cursor, expected) => {
  expect(pageNumber(trail, cursor)).toBe(expected);
});
