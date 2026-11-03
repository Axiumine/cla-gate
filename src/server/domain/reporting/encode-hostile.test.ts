// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { neutraliseText, renderName } from './encode.ts';
import {
  codePointCount,
  HOSTILE_ROWS,
  hasUnsafeCharacter,
  isOneCodeSpan,
  isOneLine,
  showZeroWidth,
  unguardedMarks,
  ZWSP,
} from './test-support.ts';

// E09-S01, the hostile corpus (src/shared/hostile-names.ts, the one list every test of what GitHub shows imports): every
// name of both lists renders as one inert line, and the rendered lists are kept in a snapshot file a person can read.

/** The two functions that format user text, with the name a test title shows. */
const RENDERERS: readonly (readonly [name: string, render: (raw: string) => string])[] = [
  ['renderName', renderName],
  ['neutraliseText', neutraliseText],
];

/** Both functions put an `@` or a `#` in, at most once per mark, so the output may exceed its cut by exactly that many. */
function marksIn(text: string): number {
  return Array.from(text.matchAll(/[@#]/gu)).length;
}

test('the corpus under test is both frozen lists of src/shared, with no copy of them', () => {
  expect(HOSTILE_ROWS.map(([, name]) => name)).toEqual([...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES]);
  expect(HOSTILE_ROWS.length).toBeGreaterThan(30);
});

test.each(HOSTILE_ROWS)('renderName renders %s as one inert line', (_label, name) => {
  const rendered = renderName(name);
  expect(isOneLine(rendered)).toBe(true);
  expect(rendered.startsWith('`')).toBe(true);
  expect(rendered.endsWith('`')).toBe(true);
  expect(isOneCodeSpan(rendered)).toBe(true);
  expect(unguardedMarks(rendered)).toEqual([]);
  // At most 64 code points of name, the ellipsis, a fence at each end and a padding space at each end.
  const fence = /^`+/u.exec(rendered)?.[0].length ?? 0;
  expect(codePointCount(rendered)).toBeLessThanOrEqual(64 + 1 + marksIn(rendered) + 2 * fence + 2);
  expect(hasUnsafeCharacter(rendered)).toBe(false);
  expect(rendered.isWellFormed()).toBe(true);
});

test.each(HOSTILE_ROWS)('neutraliseText renders %s as one inert line', (_label, name) => {
  const text = neutraliseText(name);
  expect(isOneLine(text)).toBe(true);
  expect(unguardedMarks(text)).toEqual([]);
  expect(text.isWellFormed()).toBe(true);
  expect(hasUnsafeCharacter(text)).toBe(false);
  // Once every escape pair is taken out, no character of the Markdown punctuation set is left unescaped.
  expect(text.replaceAll(/\\[\s\S]/gu, '')).not.toMatch(/[\\`*_[\]()<>#+\-.!|~&]/u);
  // At most 200 code points of text, each with at most a backslash and a zero-width space of its own.
  expect(codePointCount(text)).toBeLessThanOrEqual(200 * 3);
});

test.each(RENDERERS)('%s makes every @ of an email-shaped name inert', (_name, render) => {
  const output = render('a@b.co');
  expect(output).toContain(`@${ZWSP}`);
  expect(unguardedMarks(output)).toEqual([]);
  expect(output.match(/@/gu)).toHaveLength(1);
});

test('the corpus holds the names the story is about, so the checks above are not vacuous', () => {
  expect(renderName('@everyone')).toBe(`\`@${ZWSP}everyone\``);
  expect(renderName('/recheck')).toBe('`/recheck`');
  expect(renderName('trailing backslash\\')).toBe('`trailing backslash\\`');
  expect(renderName('a | b')).toBe('`a | b`');
  expect(renderName('` `` ``` ````')).toBe('````` ` `` ``` ```` `````');
  expect(renderName(HOSTILE_NAMES.at(-1) ?? '')).toBe(`\`${'n'.repeat(64)}…\``);
});

/** Both functions over both lists as one Markdown file: the rendered text, with each zero-width space made visible. */
function renderedCorpus(): string {
  const lines = ['# Hostile names, rendered (E09-S01)', ''];
  for (const [title, render] of RENDERERS) {
    for (const [list, names] of [
      ['HOSTILE_NAMES', HOSTILE_NAMES],
      ['HOSTILE_CONTROL_NAMES', HOSTILE_CONTROL_NAMES],
    ] as const) {
      lines.push(`## ${title} over ${list}`, '');
      names.forEach((name, index) => {
        lines.push(`${index + 1}. ${showZeroWidth(render(name))}`);
      });
      lines.push('');
    }
  }
  return lines.join('\n');
}

test('the rendered lists match the stored snapshot', async () => {
  await expect(renderedCorpus()).toMatchFileSnapshot('snapshots/hostile-names.md');
});
