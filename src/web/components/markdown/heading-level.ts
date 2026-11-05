// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { HeadingLevel } from '../../ui/Heading.tsx';

// Where the headings of a CLA text sit in the outline of the page that shows it (E18-S01): a text has its own `#` headings, and
// the page has its own `h1`, so the text is shown one level lower, or more.

/** The tag names of the six heading levels, and the level each one is. */
const HEADING_TAGS: ReadonlyMap<string, HeadingLevel> = new Map([
  ['h1', 1],
  ['h2', 2],
  ['h3', 3],
  ['h4', 4],
  ['h5', 5],
  ['h6', 6],
]);

/** The heading level for the number `n` (at least 1): above 6 is 6, because HTML has no other. */
function clampLevel(n: number): HeadingLevel {
  switch (n) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return n;
    default:
      return 6;
  }
}

/**
 * The level at which a heading of the tree is shown, or `undefined` when `tagName` is not a heading. `top` is the level that the
 * tree's own `h1` is shown as; every other heading moves down by the same amount, and none goes past `h6`.
 */
export function shownHeadingLevel(tagName: string, top: HeadingLevel): HeadingLevel | undefined {
  const own = HEADING_TAGS.get(tagName);
  return own === undefined ? undefined : clampLevel(own - 1 + top);
}
