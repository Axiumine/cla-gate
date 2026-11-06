// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { HeadingLevel } from '../../ui/Heading.tsx';
import { shownHeadingLevel } from './heading-level.ts';

// E18-S01: where the headings of a CLA text sit under the heading of the page that shows it.

const SHOWN: readonly (readonly [tagName: string, top: HeadingLevel, expected: HeadingLevel])[] = [
  ['h1', 2, 2],
  ['h2', 2, 3],
  ['h4', 2, 5],
  ['h5', 2, 6],
  ['h6', 2, 6],
  ['h1', 1, 1],
  ['h3', 1, 3],
  ['h1', 3, 3],
  ['h6', 1, 6],
  ['h1', 6, 6],
  ['h6', 6, 6],
];

test.each(SHOWN)(
  "the tree's %s, with the text starting at level %i, is shown as level %i",
  (tagName, top, expected) => {
    expect(shownHeadingLevel(tagName, top)).toBe(expected);
  },
);

test.each(['p', 'h7', 'h0', 'hh', 'H1', 'a'])('%s is not a heading, so it has no level', (tagName) => {
  expect(shownHeadingLevel(tagName, 2)).toBeUndefined();
});
