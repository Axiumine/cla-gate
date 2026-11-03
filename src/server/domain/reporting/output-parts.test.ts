// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { renderName } from './encode.ts';
import {
  type ListPart,
  MAX_LIST_ENTRIES,
  MAX_OUTPUT_UNITS,
  OutputTooLongError,
  renderParts,
  truncationLine,
} from './output-parts.ts';
import { HOSTILE_ROWS, isOneCodeSpan } from './test-support.ts';

// E09-S02: the length rules of the output. A list shows at most 50 entries and then one line `…and N more (list truncated)`;
// the whole stays within 60 000 UTF-16 code units; and a cut is made between entries, never inside one, so a code span survives.

function list(entries: readonly string[]): ListPart {
  return { kind: 'list', entries };
}

/** `count` bullets, `- entry 1` to `- entry <count>`. */
function bullets(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `- entry ${index + 1}`);
}

test('the limits are the ones GitHub allows, with room to spare', () => {
  expect([MAX_LIST_ENTRIES, MAX_OUTPUT_UNITS]).toEqual([50, 60_000]);
});

test.each([
  [1, '…and 1 more (list truncated)'],
  [200, '…and 200 more (list truncated)'],
  [9950, '…and 9950 more (list truncated)'],
])('the truncation line for %i entries left out is %s', (omitted, line) => {
  expect(truncationLine(omitted)).toBe(line);
});

test('the truncation line prints only a safe integer', () => {
  expect(() => truncationLine(1.5)).toThrow('Not a safe integer id');
});

test.each([
  [0, 0, ''],
  [1, 1, ''],
  [50, 50, ''],
  [51, 50, '…and 1 more (list truncated)'],
  [250, 50, '…and 200 more (list truncated)'],
  [10_000, 50, '…and 9950 more (list truncated)'],
])('a list of %i entries shows %i and ends with %j', (count, shown, marker) => {
  const entries = bullets(count);
  const expected = [...entries.slice(0, shown).join('\n').split('\n'), ...(marker === '' ? [] : ['', marker])];
  expect(renderParts([list(entries)])).toBe(count === 0 ? '' : expected.join('\n'));
});

test('the truncation line follows a blank line, so Markdown does not fold it into the last bullet', () => {
  const lines = renderParts([list(bullets(51))]).split('\n');
  expect(lines.slice(-3)).toEqual(['- entry 50', '', '…and 1 more (list truncated)']);
});

test('a list of exactly 50 entries has no truncation line', () => {
  expect(renderParts([list(bullets(50))])).not.toContain('truncated');
});

test('one entry with a name of 10 000 characters is kept whole once the name is encoded', () => {
  const entry = `- ${renderName('x'.repeat(10_000))}`;
  expect(entry).toHaveLength(2 + 2 + 64 + 1);
  expect(renderParts([list([entry])])).toBe(entry);
});

test('entries of 10 000 characters are cut at an entry boundary: five fit, the rest are counted', () => {
  const entry = `- ${'y'.repeat(9998)}`;
  const text = renderParts([list(Array.from({ length: 50 }, () => entry))]);
  expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT_UNITS);
  expect(text.split('\n')).toEqual([...Array.from({ length: 5 }, () => entry), '', '…and 45 more (list truncated)']);
});

test('an entry too long for the limit is left out whole, and the line says so', () => {
  expect(renderParts([list([`- ${'z'.repeat(70_000)}`])])).toBe('…and 1 more (list truncated)');
});

test('the limit counts UTF-16 code units, not code points', () => {
  const entry = '\u{1f600}'.repeat(15);
  expect(Array.from(`${entry}\n${entry}`)).toHaveLength(31);
  expect(renderParts([list([entry, entry])], 60)).toBe(`${entry}\n\n…and 1 more (list truncated)`);
});

test('an entry that ends exactly at the limit is kept', () => {
  expect(renderParts([list(['a'.repeat(40)])], 40)).toBe('a'.repeat(40));
});

test('one unit more than the limit and the entry is left out', () => {
  expect(renderParts([list(['a'.repeat(41)])], 40)).toBe('…and 1 more (list truncated)');
});

test('the parts come out in order with a blank line between them', () => {
  const parts = [
    { kind: 'text', text: '### Not signed (2)' },
    list(['- a', '- b']),
    { kind: 'text', text: 'After fixing, comment `/recheck`.' },
  ] as const;
  expect(renderParts(parts)).toBe('### Not signed (2)\n\n- a\n- b\n\nAfter fixing, comment `/recheck`.');
});

test('an empty text and an empty list add nothing, not even a separator', () => {
  const parts = [{ kind: 'text', text: '' }, list([]), { kind: 'text', text: 'only this' }, list([])] as const;
  expect(renderParts(parts)).toBe('only this');
});

test('no parts give an empty string', () => {
  expect(renderParts([])).toBe('');
});

test('text is never cut: it is paid for first and the list gets what is left', () => {
  const head = { kind: 'text', text: 'Head' } as const;
  const entries = Array.from({ length: 5 }, () => '- aaaaaaaaaa');
  expect(renderParts([head, list(entries)], 60)).toBe('Head\n\n- aaaaaaaaaa\n\n…and 4 more (list truncated)');
});

test('a list served first cannot starve the truncation line of the next one', () => {
  const entries = Array.from({ length: 5 }, () => '- aaaaaaaaaa');
  const text = renderParts([list(entries), list(entries)], 100);
  expect(text).toBe(`${entries.join('\n')}\n\n…and 5 more (list truncated)`);
  expect(text.length).toBeLessThanOrEqual(100);
});

test('the same two lists with room for both show both', () => {
  const entries = Array.from({ length: 5 }, () => '- aaaaaaaaaa');
  expect(renderParts([list(entries), list(entries)], 200)).toBe(`${entries.join('\n')}\n\n${entries.join('\n')}`);
});

test.each([
  [[{ kind: 'text', text: 'x'.repeat(11) }] as const, 10],
  [[{ kind: 'text', text: 'x'.repeat(9) }, list(['- a'])] as const, 20],
])('text that cannot fit the limit with its list throws instead of being cut (case %#)', (parts, limit) => {
  expect(() => renderParts(parts, limit)).toThrow(OutputTooLongError);
});

test('text exactly as long as the limit is accepted', () => {
  expect(renderParts([{ kind: 'text', text: 'x'.repeat(10) }], 10)).toBe('x'.repeat(10));
});

test('the error names itself and holds no text', () => {
  expect(() => renderParts([{ kind: 'text', text: 'secret-looking text' }], 3)).toThrow(
    expect.objectContaining({
      name: 'OutputTooLongError',
      message: 'The fixed text of an output does not fit its length limit',
    }),
  );
});

test('250 entries made of the hostile corpus lose whole entries and no code span', () => {
  const encoded = HOSTILE_ROWS.map(([, name]) => `- ${renderName(name)}`);
  const entries = Array.from({ length: 250 }, (_unused, index) => encoded[index % encoded.length] ?? '');
  const lines = renderParts([list(entries)]).split('\n');
  expect(lines).toHaveLength(52);
  expect(lines.slice(-2)).toEqual(['', '…and 200 more (list truncated)']);
  for (const line of lines.slice(0, -2)) {
    expect(encoded).toContain(line);
    expect(isOneCodeSpan(line.slice(2))).toBe(true);
  }
});

test('huge entries are dropped whole: two of 5 002 characters fit in 12 000 and the other 18 are counted', () => {
  const entry = `- ${'`'.repeat(5000)}`;
  const lines = renderParts([list(Array.from({ length: 20 }, () => entry))], 12_000).split('\n');
  expect(lines).toEqual([entry, entry, '', '…and 18 more (list truncated)']);
});
