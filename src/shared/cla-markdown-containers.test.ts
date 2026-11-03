// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { containerDepth } from './cla-markdown-containers.ts';
import { nestingOf } from './cla-markdown-nesting.ts';
import { documentProcessor } from './cla-markdown-parse.ts';
import { generatedMarkdown } from './test-support.ts';

// The line scan that measures how deep the quotes and lists of a CLA text nest (E12-S07) in time linear in the size of the text. Each
// row has the depth CommonMark gives the text, and the scan and the parser of the rendering must both give it.

const LIMIT = 50;
const parsedDepth = (md: string): number => nestingOf(documentProcessor().parse(md)).blocks;

const CASES: readonly (readonly [label: string, text: string, depth: number])[] = [
  ['no container', 'Plain text\n', 0],
  ['an empty text', '', 0],
  ['one quote', '> a\n', 1],
  ['quotes on one line, spaced and glued', '> > > a\n>>> a\n', 3],
  ['quotes that a blank line closes are siblings', '> a\n\n> b\n\n> c\n', 1],
  ['a quote kept open by a lazy line', '> a\nb\nc\n', 1],
  ['a lazy line between two levels of quote', '> a\nb\n> > c\n', 2],
  ['a heading is no lazy line: it closes the quote', '> a\n# h\n> > b\n', 2],
  ['a rule is no lazy line', '> a\n***\n> b\n', 1],
  ['a setext underline made of dashes is a rule inside a lazy line', '> a\n---\n', 1],
  ['an equals line goes on with the paragraph of a quote', '> a\n===\n', 1],
  ['HTML is text, so a quote after it interrupts it', '<div>\n> a\n</div>\n', 1],
  ['bullets, pluses and stars on one line', '- + * a\n', 3],
  ['ordered lists with both delimiters', '1. 1) a\n', 2],
  ['a list item is not a level of its own', '- a\n- b\n- c\n', 1],
  ['lists nested by indentation', '- a\n  - b\n    - c\n', 3],
  ['an item that goes on over a blank line', '- a\n\n  - b\n', 2],
  ['a line indented less than the item closes it', '- a\n  - b\n- c\n  - d\n', 2],
  ['a quote in a list in a quote', '> - > a\n', 3],
  ['a list below a quote below a list', '- a\n\n  > b\n  >\n  > - c\n', 3],
  ['an empty item is closed by a blank line', '-\n\n  - b\n', 1],
  ['an item of a list with a number of nine digits', '123456789. a\n', 1],
  ['a number of ten digits is no marker', '1234567890. a\n', 0],
  ['a number with no delimiter is no marker', '1 a\n', 0],
  ['a bullet glued to a word is no marker', '-a\n', 0],
  ['a rule of stars is no list', '* * *\n', 0],
  ['a rule of dashes with a space is no list', '- - -\n', 0],
  ['a rule of underscores is no list', '_ _ _\n', 0],
  ['an item that is a rule after a marker', '- ---\n', 0],
  ['an item after a paragraph, numbered 1', 'a\n1. b\n', 1],
  ['an item after a paragraph, numbered 2, is part of it', 'a\n2. b\n', 0],
  ['an empty bullet after a paragraph is an underline', 'a\n-\nb\n', 0],
  ['a bullet after a paragraph', 'a\n- b\n  - c\n', 2],
  ['a numbered item inside a quote, after a paragraph outside', 'a\n> 1. b\n', 2],
  ['code indented four spaces opens nothing', '    > a\n    - b\n', 0],
  ['five spaces after a marker are code of the item', '-     code\n  - x\n', 2],
  ['a tab after a marker', '-\ta\n', 1],
  ['a marker, a tab and a marker', '-\t- a\n', 2],
  ['fenced code opens nothing', '```\n> > > a\n- - - b\n```\n', 0],
  ['a fence with tildes', '~~~\n> a\n~~~\n> b\n', 1],
  ['a longer fence is closed by a longer fence only', '````\n```\n> a\n````\n> b\n', 1],
  ['a fence that is never closed holds the rest of the text', '```\n> a\n> > b\n', 0],
  ['a backtick in the info string makes it no fence', '``` a`b\n> x\n', 1],
  ['a fence inside a quote ends with the quote', '> ```\n> a\n\n> > b\n', 2],
  ['a fence inside an item ends with the item', '- ```\n  a\n- - b\n', 2],
  ['a closing fence indented four spaces is code', '```\n    ```\n> a\n```\n', 0],
  ['a quote after a heading', '# h\n> a\n', 1],
  ['CRLF line endings', '> a\r\n> > b\r\n', 2],
  ['lone CR line endings', '- a\r  - b\r', 2],
  ['a marker that is not at the start of the line', 'a > b - c\n', 0],
];

test.each(CASES)('containerDepth reads %s as %d levels, and so does the parser', (_label, text, depth) => {
  expect(containerDepth(text, LIMIT)).toBe(depth);
  expect(parsedDepth(text)).toBe(depth);
});

test.each([
  ['a million quotes', '> '.repeat(1_000_000)],
  ['a million alternating bullets', '+ * '.repeat(500_000)],
  ['five thousand lines of forty quotes', `${'> '.repeat(40)}a\n`.repeat(5000)],
  ['quotes in bullets', `${'> - '.repeat(100)}a\n`],
])('containerDepth stops one level above the limit: %s', (_label, text) => {
  expect(containerDepth(text, 3)).toBe(4);
});

test.each([
  ['a line of dashes and spaces is a rule', '- '.repeat(1000)],
  ['a line of stars and spaces is a rule', '* '.repeat(1000)],
])('containerDepth: %s, not a nest', (_label, text) => {
  expect(containerDepth(text, LIMIT)).toBe(0);
});

test('the limit is the one the caller gives: the depth is exact up to it', () => {
  expect(containerDepth('> > > a\n', 3)).toBe(3);
  expect(containerDepth('> > > > a\n', 3)).toBe(4);
  expect(containerDepth('> > > > a\n', 10)).toBe(4);
});

test('the scan and the parser agree on 3 000 generated texts, and the texts reach every depth up to five', () => {
  const depths = new Set<number>();
  for (const text of generatedMarkdown(11, 3000)) {
    const parsed = parsedDepth(text);
    expect(containerDepth(text, LIMIT), JSON.stringify(text)).toBe(parsed);
    depths.add(parsed);
  }
  expect([...depths].filter((depth) => depth <= 5).toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
});

test('a text of 100 KiB of container markers is read at once', () => {
  const started = performance.now();
  expect(containerDepth('> '.repeat(51_200), LIMIT)).toBe(LIMIT + 1);
  expect(containerDepth('+ * '.repeat(25_600), LIMIT)).toBe(LIMIT + 1);
  expect(containerDepth('1. '.repeat(34_000), LIMIT)).toBe(LIMIT + 1);
  expect(performance.now() - started).toBeLessThan(2000);
});
