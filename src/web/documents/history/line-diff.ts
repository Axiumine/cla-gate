// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { diffLines } from 'diff';

// The line diff of two versions of a CLA (E18-S11), computed in the browser from the two texts the server sent and checked: nothing
// about it is stored or sent. The texts are canonical (LF line ends, E12-S02), so a line is what lies between two line feeds.

/** How a line stands between the two texts: it is in both, only in the older one (removed) or only in the newer one (added). */
type LineKind = 'same' | 'removed' | 'added';

export interface DiffLine {
  readonly kind: LineKind;
  /** The line as it is written, without its line feed. A text a person wrote: it is shown through `UserText` and never as markup. */
  readonly text: string;
  /** The place of the line in the diff, from 0: a key that is the same for the same line on every render. */
  readonly at: number;
}

/** A line before it has its place in the diff. */
type BareLine = Omit<DiffLine, 'at'>;

/**
 * The most edits the diff looks for before it gives up. A text holds at most 200 KiB, so two texts that share nothing can be
 * a hundred thousand edits apart, and the search then costs more than the person will wait for. Past the limit the two texts are
 * shown as what they are: every line of the older one removed, every line of the newer one added.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const MAX_EDITS = 2000;

/**
 * Unchanged lines in a row beyond this many are folded into one group that the person opens. Six lines or fewer stay: a fold that hides
 * less than the line that opens it is no help.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const MAX_UNFOLDED_RUN = 6;

/** The lines of a chunk of text: split at line feeds, with no empty last line for the line feed that ends the chunk. */
function linesOf(chunk: string): string[] {
  const lines = chunk.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

/** Every line of `text` as one kind. */
function allAs(kind: LineKind, text: string): BareLine[] {
  return linesOf(text).map((line) => ({ kind, text: line }));
}

/** The lines in reading order, each with its place. */
function numbered(lines: readonly BareLine[]): DiffLine[] {
  return lines.map((line, at) => ({ ...line, at }));
}

/** What `diffLines` found, or the two texts as they are when the search gave up (`undefined`): every line of the older removed, every line of the newer added. */
function changesOf(from: string, to: string): BareLine[] {
  const changes = diffLines(from, to, { maxEditLength: MAX_EDITS });
  if (changes === undefined) {
    return [...allAs('removed', from), ...allAs('added', to)];
  }
  return changes.flatMap((change) => {
    if (change.added) {
      return allAs('added', change.value);
    }
    return allAs(change.removed ? 'removed' : 'same', change.value);
  });
}

/**
 * The lines of the two texts in reading order: what `from` has and `to` has not is `removed`, what `to` has and `from` has not is
 * `added`, and the rest `same`. Two identical texts are all `same`.
 */
export function diffOf(from: string, to: string): DiffLine[] {
  return numbered(from === to ? allAs('same', from) : changesOf(from, to));
}

/** Whether the two texts have no line that differs. */
export function isIdentical(lines: readonly DiffLine[]): boolean {
  return lines.every((line) => line.kind === 'same');
}

/** What the screen draws: one changed line, one unchanged line, or a run of unchanged lines folded into a group. */
export type DiffItem =
  | { readonly type: 'line'; readonly line: DiffLine }
  | { readonly type: 'folded'; readonly at: number; readonly lines: readonly DiffLine[] };

/** The items of a run of unchanged lines: each on its own when the run is short enough, else one folded group (`at` is the place of its first line). */
function itemsOfRun(run: readonly DiffLine[]): DiffItem[] {
  const [first] = run;
  if (first === undefined) {
    return [];
  }
  return run.length > MAX_UNFOLDED_RUN
    ? [{ type: 'folded', at: first.at, lines: run }]
    : run.map((line) => ({ type: 'line', line }));
}

/**
 * The lines as items: every changed line, and the unchanged lines in between either as they are or, for a run of more than
 * {@link MAX_UNFOLDED_RUN} lines, as one group. A run is made of consecutive unchanged lines, so a changed line ends it.
 */
export function foldRuns(lines: readonly DiffLine[]): DiffItem[] {
  const items: DiffItem[] = [];
  let run: DiffLine[] = [];
  for (const line of lines) {
    if (line.kind === 'same') {
      run.push(line);
    } else {
      items.push(...itemsOfRun(run), { type: 'line', line });
      run = [];
    }
  }
  items.push(...itemsOfRun(run));
  return items;
}
