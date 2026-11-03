// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The line-level pieces of CommonMark that the container scan (`cla-markdown-containers.ts`) is made of (E12-S07): where the white
// space of a line ends in characters and in columns, and whether the rest of it is a thematic break. Every function here looks at one
// line, from a position on, and reads each character at most once, so the cost of a text is the cost of its size.

const TAB_STOP = 4;
/** Indentation of this many columns or more is a code block (or the continuation of a paragraph), never the start of a container. */
export const CODE_INDENT = 4;
/** A thematic break is three or more of its character. */
const MIN_BREAK = 3;

/** A place in a line: the index of the character and the column it is shown at (a tab goes to the next multiple of four). */
export interface Cursor {
  readonly pos: number;
  readonly col: number;
}

/** True for a space or a tab. */
export function isBlankChar(char: string): boolean {
  return char === ' ' || char === '\t';
}

/** The cursor after the next character, which is a space or a tab or any other single character. */
export function step(line: string, cursor: Cursor): Cursor {
  const tab = line.charAt(cursor.pos) === '\t';
  return { pos: cursor.pos + 1, col: tab ? cursor.col + TAB_STOP - (cursor.col % TAB_STOP) : cursor.col + 1 };
}

/** The cursor after the white space that starts at `from`. */
export function skipWhite(line: string, from: Cursor): Cursor {
  let cursor = from;
  while (isBlankChar(line.charAt(cursor.pos))) {
    cursor = step(line, cursor);
  }
  return cursor;
}

/** The cursor after `columns` columns of white space from `from`, or after all of it when it is shorter. */
export function skipColumns(line: string, from: Cursor, columns: number): Cursor {
  let cursor = from;
  while (cursor.col - from.col < columns && isBlankChar(line.charAt(cursor.pos))) {
    cursor = step(line, cursor);
  }
  return cursor;
}

/** True when nothing but white space is left of the line from `pos` on. */
export function isBlankFrom(line: string, pos: number): boolean {
  return skipWhite(line, { pos, col: 0 }).pos >= line.length;
}

/** True when the line from `pos` on is three or more of one of `*`, `-` or `_`, with white space allowed between and after them. */
export function isThematicBreak(line: string, pos: number): boolean {
  const char = line.charAt(pos);
  if (char !== '*' && char !== '-' && char !== '_') {
    return false;
  }
  let count = 0;
  for (let index = pos; index < line.length; index += 1) {
    const current = line.charAt(index);
    if (current === char) {
      count += 1;
    } else if (!isBlankChar(current)) {
      return false;
    }
  }
  return count >= MIN_BREAK;
}
