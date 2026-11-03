// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { renderId } from './encode.ts';

// E09-S02: how the parts of a Check Run's `summary` or `text` (and, in E09-S07, of a pull request comment) become one string
// that GitHub accepts. GitHub allows 65 535 UTF-16 code units in `summary` and `text` and 65 536 in a comment; this module
// stays under 60 000. A list shows at most 50 entries, and when entries are left out, or the whole does not fit, the list is
// cut at an entry boundary and ends with one visible line, so a code span (an entry is built from them) is never cut in half.
// The entries are lines that the caller has already encoded (E09-S01); nothing here reads a name.

/** The most entries a list shows, however short they are. */
export const MAX_LIST_ENTRIES = 50;

/** The most UTF-16 code units a `summary`, a `text` or a comment body holds: GitHub's limit is 65 535, this leaves room. */
export const MAX_OUTPUT_UNITS = 60_000;

/** What separates two parts: one blank line, so a heading, a paragraph and a list never run into each other. */
const PART_SEPARATOR = '\n\n';

/** Text that is kept whole: a heading, a sentence, a link. */
export interface TextPart {
  readonly kind: 'text';
  readonly text: string;
}

/** A list of entries, each one encoded line (for example a Markdown bullet), which may be cut at an entry boundary. */
export interface ListPart {
  readonly kind: 'list';
  readonly entries: readonly string[];
}

export type OutputPart = TextPart | ListPart;

/** Thrown when the text parts alone, which no cut may touch, do not fit the limit: a mistake in the code that built them. */
export class OutputTooLongError extends Error {
  override readonly name = 'OutputTooLongError';

  constructor() {
    super('The fixed text of an output does not fit its length limit');
  }
}

/** The line that tells a reader that `omitted` entries are not shown. */
export function truncationLine(omitted: number): string {
  return `…and ${renderId(omitted)} more (list truncated)`;
}

/** True for a part that adds something to the output: text that is not empty, a list that has an entry. */
function isShown(part: OutputPart): boolean {
  return part.kind === 'text' ? part.text !== '' : part.entries.length > 0;
}

/**
 * The room a list keeps for itself before any entry: the blank line and the longest truncation line it could need. Counted
 * with all of its entries as the number left out, which has at least as many digits as any real count.
 */
function markerRoom(entries: readonly string[]): number {
  return PART_SEPARATOR.length + truncationLine(entries.length).length;
}

/** The first `shown` entries, then the truncation line when some are left out. Entries past the 50th are never in `shown`. */
function listBlock(entries: readonly string[], shown: number): string {
  const lines = entries.slice(0, shown).join('\n');
  const omitted = entries.length - shown;
  if (omitted === 0) {
    return lines;
  }
  return shown === 0 ? truncationLine(omitted) : `${lines}${PART_SEPARATOR}${truncationLine(omitted)}`;
}

/** The longest start of `entries` that, with its truncation line when it is not the whole list, is at most `room` long. */
function fitList(entries: readonly string[], room: number): string {
  let shown = Math.min(entries.length, MAX_LIST_ENTRIES);
  let block = listBlock(entries, shown);
  while (block.length > room) {
    shown -= 1;
    block = listBlock(entries, shown);
  }
  return block;
}

/**
 * The parts as one string, in order, a blank line between them, at most `limit` UTF-16 code units long. A text part and an
 * empty list are kept whole or left out; a list shows at most {@link MAX_LIST_ENTRIES} entries and loses entries from its end
 * (never a part of one) while the whole is too long, and ends with {@link truncationLine} when it lost any. The lists are
 * served in order, each after the text and the truncation lines of the others have been paid for.
 * @throws OutputTooLongError when the text parts and the truncation lines alone are longer than `limit`.
 */
export function renderParts(parts: readonly OutputPart[], limit: number = MAX_OUTPUT_UNITS): string {
  const shown = parts.filter(isShown);
  const textLength = shown.reduce((sum, part) => sum + (part.kind === 'text' ? part.text.length : 0), 0);
  const reserved = shown.reduce((sum, part) => sum + (part.kind === 'list' ? markerRoom(part.entries) : 0), 0);
  const separators = Math.max(0, shown.length - 1) * PART_SEPARATOR.length;
  let spare = limit - textLength - reserved - separators;
  if (spare < 0) {
    throw new OutputTooLongError();
  }
  return shown
    .map((part) => {
      if (part.kind === 'text') {
        return part.text;
      }
      const reserve = markerRoom(part.entries);
      const block = fitList(part.entries, reserve + spare);
      spare += reserve - block.length;
      return block;
    })
    .join(PART_SEPARATOR);
}
