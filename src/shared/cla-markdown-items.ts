// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  CODE_INDENT,
  type Cursor,
  isBlankChar,
  isBlankFrom,
  isThematicBreak,
  skipWhite,
  step,
} from './cla-markdown-lines.ts';

// The containers a line can open (E12-S07): a block quote, or a list item with the marker that opens it, read at a position of a line.
// Used by the container scan (`cla-markdown-containers.ts`); every function reads each character of the line at most once.

/** The most digits of the number of an ordered item. */
const MAX_DIGITS = 9;

/** What a line must hold to keep a container open, and what the container holds so far. */
export interface Container {
  readonly kind: 'quote' | 'item';
  /** For an item, the columns of white space that continue it: the width of the marker and of the space after it. */
  readonly indent: number;
  /** True for an item whose marker ended its line and that has had no content line since: a blank line then closes it. */
  empty: boolean;
}

/** The result of reading a marker: the container it opens and the cursor after the marker and the white space that follows it. */
interface Opened {
  readonly container: Container;
  readonly cursor: Cursor;
}

/** True for an ASCII digit. */
function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

/** The marker of a list item at `pos`: `-`, `+` or `*`, or one to nine digits and a `.` or a `)`; the length of it, or 0 when there is none. */
function markerLength(line: string, pos: number): number {
  const char = line.charAt(pos);
  if (char === '-' || char === '+' || char === '*') {
    return 1;
  }
  let end = pos;
  while (end - pos <= MAX_DIGITS && isDigit(line.charAt(end))) {
    end += 1;
  }
  const delimiter = line.charAt(end);
  const digits = end - pos;
  return digits >= 1 && digits <= MAX_DIGITS && (delimiter === '.' || delimiter === ')') ? digits + 1 : 0;
}

/**
 * The length of the marker of a list item at `pos`, or 0. A marker needs a space, a tab or the end of the line after it, and a
 * thematic break (`* * *`, `- - -`) is a rule, not a marker.
 */
function markerAt(line: string, pos: number): number {
  const length = markerLength(line, pos);
  const after = pos + length;
  const closed = after >= line.length || isBlankChar(line.charAt(after));
  return length > 0 && closed && !isThematicBreak(line, pos) ? length : 0;
}

/** True when an item with this marker may start in the middle of a paragraph: it has something after it and, if ordered, is numbered 1. */
function mayInterrupt(line: string, pos: number, length: number, empty: boolean): boolean {
  return !empty && (length === 1 || line.slice(pos, pos + length - 1) === '1');
}

/** Where the content of an item starts: after the white space that follows the marker; five columns or more are a code block, of which only the first belongs to the marker. */
function contentStart(line: string, marked: Cursor, empty: boolean): Cursor {
  if (empty) {
    return { pos: line.length, col: marked.col + 1 };
  }
  const white = skipWhite(line, marked);
  return white.col - marked.col > CODE_INDENT ? step(line, marked) : white;
}

/**
 * The list item that starts at `start` (after the white space of the line that begins at `cursor`), or `null`. With `interrupts`
 * the item would start in the middle of a paragraph, where an empty item, or one numbered other than 1, is text.
 */
function itemAt(line: string, cursor: Cursor, start: Cursor, interrupts: boolean): Opened | null {
  const length = markerAt(line, start.pos);
  const empty = isBlankFrom(line, start.pos + length);
  if (length === 0 || (interrupts && !mayInterrupt(line, start.pos, length, empty))) {
    return null;
  }
  const marked: Cursor = { pos: start.pos + length, col: start.col + length };
  const content = contentStart(line, marked, empty);
  const indent = start.col - cursor.col + length + (content.col - marked.col);
  return { container: { kind: 'item', indent, empty }, cursor: content };
}

/** The cursor after the `>` at `start` and the one space or tab that may follow it. */
export function afterQuoteMarker(line: string, start: Cursor): Cursor {
  const marked = step(line, start);
  return isBlankChar(line.charAt(marked.pos)) ? step(line, marked) : marked;
}

/** The container the line opens at `start` (the first character after the white space that begins at `cursor`), or `null`. */
function openOne(line: string, cursor: Cursor, start: Cursor, interrupts: boolean): Opened | null {
  if (line.charAt(start.pos) === '>') {
    return { container: { kind: 'quote', indent: 0, empty: false }, cursor: afterQuoteMarker(line, start) };
  }
  return itemAt(line, cursor, start, interrupts);
}

/** The containers a line opens and the cursor after their markers. */
interface Opening {
  readonly containers: Container[];
  readonly cursor: Cursor;
}

/**
 * The quotes and items the line opens from `from` on, one after the other (`> - a` opens two), and the cursor after their
 * markers. No more than `room` are opened (and one more, so the caller sees the limit passed), so a line of a million markers is
 * read only as far as the limit. With `interrupts` the line would start in the middle of a paragraph.
 */
export function openContainers(line: string, from: Cursor, room: number, interrupts: boolean): Opening {
  const containers: Container[] = [];
  let cursor = from;
  while (containers.length <= room) {
    const start = skipWhite(line, cursor);
    const indented = start.col - cursor.col >= CODE_INDENT;
    const opened = start.pos >= line.length || indented ? null : openOne(line, cursor, start, interrupts);
    if (opened === null) {
      break;
    }
    containers.push(opened.container);
    cursor = opened.cursor;
  }
  return { containers, cursor };
}
