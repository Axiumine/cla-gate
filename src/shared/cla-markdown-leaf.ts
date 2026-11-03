// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  CODE_INDENT,
  type Cursor,
  isBlankChar,
  isBlankFrom,
  isThematicBreak,
  skipWhite,
} from './cla-markdown-lines.ts';

// What a line is once the containers before it are read (E12-S07): blank, text, code, a heading, a rule, a setext underline or the
// start of a fence. Used by the container scan (`cla-markdown-containers.ts`); every function reads each character at most once.

/** A fence is three or more backticks or tildes. */
const MIN_FENCE = 3;

/** What is left of a line once its containers are read, as far as the container scan needs to know. */
export type Leaf =
  | { readonly kind: 'blank' | 'text' | 'code' | 'heading' | 'break' | 'setext' }
  | { readonly kind: 'fence'; readonly char: string; readonly length: number };

/** An open fenced code block: its character and the length of its opening fence. */
export interface Fence {
  readonly char: string;
  readonly length: number;
}

/** How many times the character `char` repeats from `pos` on. */
function runLength(line: string, pos: number, char: string): number {
  let end = pos;
  while (line.charAt(end) === char) {
    end += 1;
  }
  return end - pos;
}

/** True when the line from `pos` on is `char` repeated and white space, and nothing else: a setext underline is `=` or `-` that way. */
function isUnderline(line: string, pos: number, char: string): boolean {
  const end = pos + runLength(line, pos, char);
  return end > pos && isBlankFrom(line, end);
}

/** True when the line from `pos` on opens an ATX heading: one to six `#` and then a space, a tab or the end. */
function isHeading(line: string, pos: number): boolean {
  const hashes = runLength(line, pos, '#');
  return hashes >= 1 && hashes <= 6 && (pos + hashes >= line.length || isBlankChar(line.charAt(pos + hashes)));
}

/** The fence the line from `pos` on opens, or `null`: three or more backticks (none after them on the line) or three or more tildes. */
function fenceAt(line: string, pos: number): Fence | null {
  const char = line.charAt(pos);
  if (char !== '`' && char !== '~') {
    return null;
  }
  const length = runLength(line, pos, char);
  if (length < MIN_FENCE || (char === '`' && line.includes('`', pos + length))) {
    return null;
  }
  return { char, length };
}

/**
 * What the line from `cursor` on is, the containers before it being read. `paragraph` is true when a paragraph is open for the
 * line to continue, and `underlines` when the line may be the underline that turns it into a heading (the line must belong to the
 * same container as the paragraph, which a lazy line does not).
 */
export function classify(line: string, cursor: Cursor, paragraph: boolean, underlines: boolean): Leaf {
  const start = skipWhite(line, cursor);
  if (start.pos >= line.length) {
    return { kind: 'blank' };
  }
  if (start.col - cursor.col >= CODE_INDENT) {
    return { kind: paragraph ? 'text' : 'code' };
  }
  const fence = fenceAt(line, start.pos);
  if (fence !== null) {
    return { kind: 'fence', ...fence };
  }
  if (isHeading(line, start.pos)) {
    return { kind: 'heading' };
  }
  if (underlines && (isUnderline(line, start.pos, '=') || isUnderline(line, start.pos, '-'))) {
    return { kind: 'setext' };
  }
  return { kind: isThematicBreak(line, start.pos) ? 'break' : 'text' };
}

/** True when the line from `cursor` on closes `fence`: the same character at least as many times, and nothing else, indented less than four columns. */
export function closesFence(line: string, cursor: Cursor, fence: Fence): boolean {
  const start = skipWhite(line, cursor);
  if (start.col - cursor.col >= CODE_INDENT) {
    return false;
  }
  const length = runLength(line, start.pos, fence.char);
  return length >= fence.length && isBlankFrom(line, start.pos + length);
}
