// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';

// Helpers for the tests of src/server/domain/reporting: the shared hostile corpus in the shape `test.each` wants, and the
// checks every rendered name must pass. They read the output as text and know nothing of the encoder, so a test that uses
// them cannot pass because the encoder and the check share a mistake.

/** U+200B, the zero-width space the encoder puts after an `@` or a `#`. */
export const ZWSP = String.fromCodePoint(0x200b);

/** Both frozen hostile lists (`src/shared/hostile-names.ts`) as `[label, name]` rows: the label is cut short for the title. */
export const HOSTILE_ROWS: readonly (readonly [label: string, name: string])[] = [
  ...HOSTILE_NAMES,
  ...HOSTILE_CONTROL_NAMES,
].map((name) => [JSON.stringify(name).slice(0, 40), name] as const);

/** The code point ranges that must not reach the output, written as numbers: C0, DEL and C1, the separators and the bidi controls. */
const UNSAFE_RANGES: readonly (readonly [first: number, last: number])[] = [
  [0x0, 0x1f],
  [0x7f, 0x9f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

/** The number of Unicode code points in `text`. */
export function codePointCount(text: string): number {
  return Array.from(text).length;
}

/** True when `text` holds no line break of any kind (LF, CR, NEL, line and paragraph separator). */
export function isOneLine(text: string): boolean {
  return !/[\n\r\u0085\p{Zl}\p{Zp}]/u.test(text);
}

/** True when `text` holds a control, a line or paragraph separator or a bidirectional control: nothing GitHub should be sent. */
export function hasUnsafeCharacter(text: string): boolean {
  return Array.from(text).some((character) => {
    // The first UTF-16 unit is the whole code point below U+10000, and a surrogate (in no range) above it.
    const code = character.charCodeAt(0);
    return UNSAFE_RANGES.some(([first, last]) => code >= first && code <= last);
  });
}

/** The `@` and `#` in `text` that are not followed by U+200B: each one could still mention someone or link an issue. */
export function unguardedMarks(text: string): string[] {
  return Array.from(text.matchAll(/[@#](?!\u{200b})/gu), (match) => match[0]);
}

/** The length of the longest run of backticks in `text`. */
export function longestBackticks(text: string): number {
  return Math.max(0, ...Array.from(text.matchAll(/`+/gu), (match) => match[0].length));
}

/** True when `rendered` is exactly one inline code span: one fence at each end that no backtick run inside reaches. */
export function isOneCodeSpan(rendered: string): boolean {
  const fence = rendered.length - rendered.replace(/^`+/u, '').length;
  const inner = rendered.slice(fence, rendered.length - fence);
  return fence > 0 && rendered.endsWith('`'.repeat(fence)) && !inner.endsWith('`') && longestBackticks(inner) < fence;
}

/** `text` with each U+200B written as `⟦ZWSP⟧`, so a snapshot file shows where the encoder broke a mention. */
export function showZeroWidth(text: string): string {
  return text.replaceAll(ZWSP, '⟦ZWSP⟧');
}
