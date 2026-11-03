// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E09-S01: the Markdown building blocks of encode.ts, which is the only way user text reaches them. They are pure and they
// trust their input to be cleaned already (well-formed, no controls): cleaning is the job of the two public functions.

/** U+200B, the zero-width space. After an `@` or a `#` it stops GitHub turning the text into a mention or an issue link. */
const ZWSP = String.fromCodePoint(0x200b);

/** The Markdown punctuation that `neutraliseText` backslash-escapes. */
const MARKDOWN_PUNCTUATION: ReadonlySet<string> = new Set([
  '\\',
  '`',
  '*',
  '_',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  '#',
  '+',
  '-',
  '.',
  '!',
  '|',
  '~',
  '&',
]);

/** The first `limit` code points of `text`, and whether anything was cut. A surrogate pair is never split. */
export function takeCodePoints(text: string, limit: number): { readonly head: string; readonly cut: boolean } {
  let count = 0;
  let end = 0;
  for (const point of text) {
    if (count === limit) {
      return { head: text.slice(0, end), cut: true };
    }
    count += 1;
    end += point.length;
  }
  return { head: text, cut: false };
}

/** `text` with an `@` or a `#` followed by U+200B, so no renderer turns it into a mention or a link. */
export function breakMentions(text: string): string {
  return text.replace(/[@#]/gu, (mark) => `${mark}${ZWSP}`);
}

/** The length of the longest run of backticks in `text`; 0 when there is none. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.matchAll(/`+/gu)) {
    longest = Math.max(longest, run[0].length);
  }
  return longest;
}

/** One code span around `text`: a fence longer than any backtick run inside, with a space each side when `text` touches a backtick. */
export function codeSpan(text: string): string {
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** `text` with a backslash before every character of the Markdown punctuation set, and U+200B after an `@` or a `#`. */
export function escapeMarkdown(text: string): string {
  let escaped = '';
  for (const character of text) {
    escaped += MARKDOWN_PUNCTUATION.has(character) ? `\\${character}` : character;
    if (character === '@' || character === '#') {
      escaped += ZWSP;
    }
  }
  return escaped;
}
