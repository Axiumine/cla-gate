// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { renderCheckOutput } from './check-output.ts';
import type { CheckView } from './check-view.ts';
import { renderName } from './encode.ts';
import { MAX_OUTPUT_UNITS, type OutputPart } from './output-parts.ts';
import { HOSTILE_ROWS, isOneCodeSpan } from './test-support.ts';

// E09-S02, the length rules at the edge of the Check Run output: `summary` and `text` each stay within 60 000 UTF-16 code
// units (GitHub allows 65 535), a list shows at most 50 entries and then the truncation line, and a cut falls between entries.

const HEAD = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';

/** A failed check whose summary is `summary` and whose text is `text`. */
function failed(summary: readonly OutputPart[], text: readonly OutputPart[] = []): CheckView {
  return { kind: 'failure', headSha: HEAD, unsigned: 1, unlinked: 1, summary, text };
}

/** `count` bullets of a person each, the way E09-S03 lists them: a code span through `renderName`. */
function people(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => {
    const login = `person ${index + 1}`;
    return `- ${renderName(login)}`;
  });
}

test.each([
  [0, 0, null],
  [1, 1, null],
  [50, 50, null],
  [51, 50, '…and 1 more (list truncated)'],
  [250, 50, '…and 200 more (list truncated)'],
  [10_000, 50, '…and 9950 more (list truncated)'],
])('a summary list of %i entries shows %i, then %j', (count, shown, marker) => {
  const { summary } = renderCheckOutput(failed([{ kind: 'list', entries: people(count) }]));
  const lines = summary.split('\n');
  if (count === 0) {
    expect(summary).toBe('The CLA check did not pass for commit 1a2b3c4. Comment `/recheck` to run it again.');
    return;
  }
  expect(lines.slice(0, shown)).toEqual(people(shown));
  expect(lines.slice(shown)).toEqual(marker === null ? [] : ['', marker]);
});

test.each([
  [1, 1, null],
  [51, 50, '…and 1 more (list truncated)'],
  [10_000, 50, '…and 9950 more (list truncated)'],
])('a text list of %i entries is capped the same way: %i shown, then %j', (count, shown, marker) => {
  const { text } = renderCheckOutput(
    failed([{ kind: 'text', text: 'Summary.' }], [{ kind: 'list', entries: people(count) }]),
  );
  expect(text?.split('\n')).toEqual([...people(shown), ...(marker === null ? [] : ['', marker])]);
});

test('the summary and the text are each within 60 000 code units when every entry is huge', () => {
  const huge = `- ${'w'.repeat(9998)}`;
  const entries = Array.from({ length: 10_000 }, () => huge);
  const { summary, text } = renderCheckOutput(failed([{ kind: 'list', entries }], [{ kind: 'list', entries }]));
  expect(summary.length).toBeLessThanOrEqual(MAX_OUTPUT_UNITS);
  expect(text?.length).toBeLessThanOrEqual(MAX_OUTPUT_UNITS);
  expect(summary.split('\n').slice(-1)).toEqual(['…and 9995 more (list truncated)']);
});

test('one entry with a name of 10 000 characters is a short entry, and a code span that is not cut', () => {
  const entry = `- ${renderName('n'.repeat(10_000))}`;
  const { summary } = renderCheckOutput(failed([{ kind: 'list', entries: [entry] }]));
  expect(summary).toBe(entry);
  expect(isOneCodeSpan(summary.slice(2))).toBe(true);
  expect(summary.endsWith('…`')).toBe(true);
});

test('hostile names in 250 entries lose whole entries only: every kept line is one complete code span', () => {
  const encoded = HOSTILE_ROWS.map(([, name]) => `- ${renderName(name)}`);
  const entries = Array.from({ length: 250 }, (_unused, index) => encoded[index % encoded.length] ?? '');
  const lines = renderCheckOutput(failed([{ kind: 'list', entries }])).summary.split('\n');
  expect(lines.slice(-2)).toEqual(['', '…and 200 more (list truncated)']);
  expect(lines.slice(0, -2).every((line) => encoded.includes(line) && isOneCodeSpan(line.slice(2)))).toBe(true);
});
