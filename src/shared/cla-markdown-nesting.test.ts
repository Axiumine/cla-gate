// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { containerDepth } from './cla-markdown-containers.ts';
import { CLA_MAX_NESTING, isNestedTooDeeply, nestingOf, opensTooManyContainers } from './cla-markdown-nesting.ts';
import { documentProcessor } from './cla-markdown-parse.ts';
import {
  indentedBullets,
  MARKER_RUNS,
  MOST_LINEAR_SLOWDOWN,
  nestedBullets,
  nestedEmphasis,
  nestedQuotes,
  slowdownOf,
} from './test-support.ts';

// The depth rule of the CLA text (E12-S07): how the nesting of a text is measured in a tree, the line that the rendering refuses before
// it parses, the rule of `validateClaText` and that the line scan of it and the whole parse agree on the blocks.

const wholeOf = (md: string) => nestingOf(documentProcessor().parse(md));

test('the limit is 50 levels', () => {
  expect(CLA_MAX_NESTING).toBe(50);
});

test.each([
  ['no container', 'Plain text\n', 0, 0],
  ['one quote', '> a\n', 1, 0],
  ['three quotes on one line', '> > > a\n', 3, 0],
  ['three quotes without spaces', '>>> a\n', 3, 0],
  ['quotes by lazy continuation', '> a\nb\n> > c\n', 2, 0],
  ['two bullets on one line', '- - a\n', 2, 0],
  ['ordered lists with both delimiters', '1. 1) a\n', 2, 0],
  ['a list item is not a level of its own', '- a\n- b\n- c\n', 1, 0],
  ['sibling quotes do not add up', '> a\n\n> b\n\n> c\n', 1, 0],
  ['lists nested by indentation', '- a\n  - b\n    - c\n', 3, 0],
  ['a quote in a list in a quote', '> - > a\n', 3, 0],
  ['a list below a quote below a list', '- a\n\n  > b\n  >\n  > - c\n', 3, 0],
  ['emphasis is not a block', '*a*\n', 0, 1],
  ['strong text in emphasis in a link', '[*a **b***](https://example.org)\n', 0, 3],
  ['a link reference', '[*a*][r]\n\n[r]: https://example.org\n', 0, 2],
  ['inline levels in a block', '> - *a **b***\n', 2, 2],
])('nestingOf reads %s as %d block levels and %d inline levels', (_label, text, blocks, inlines) => {
  expect(wholeOf(text)).toEqual({ blocks, inlines });
});

const CORPUS = [
  '> a\nb\n',
  '> a\n\nb\n',
  '- a\n\n  b\n- c\n',
  '- a\n  > b\n  > - c\n',
  '1. a\n2. b\n   1. c\n',
  '10) a\n11) b\n',
  '* * *\n',
  '- - -\n\n- a\n',
  '> ```\n> > not a quote\n> ```\n',
  '```\n> > > not a quote\n- - - not a list\n```\n',
  '    > code\n    - code\n',
  '\\> escaped\n\\- escaped\n',
  '`> code span`\n',
  'Setext\n======\n\n> after\n',
  '[ref]: https://example.org\n\n> [ref]\n',
  '> [a\n> b](https://example.org)\n',
  '- [a](b)\n  - *c*\n',
  '> - 1. > - 1. x\n',
  'a\n- b\n  - c\n',
  '2. a\n3. b\n',
  '<div>\n> not html\n</div>\n',
  '> *a\n> b* c\n',
  '-\n  - \n    - \n',
  '- a\n\n\n- b\n',
  '>\n> a\n>\n> b\n',
];

test.each(CORPUS)('the line scan and the whole parse agree on the quotes and lists of %j', (text) => {
  expect(containerDepth(text, CLA_MAX_NESTING)).toBe(wholeOf(text).blocks);
});

test.each([
  ['50 quotes', nestedQuotes(50), false],
  ['51 quotes', nestedQuotes(51), true],
  ['50 bullets on one line', nestedBullets(50), false],
  ['51 bullets on one line', nestedBullets(51), true],
  ['50 ordered lists on one line', `${'1. '.repeat(50)}x\n`, false],
  ['51 ordered lists on one line', `${'1. '.repeat(51)}x\n`, true],
  ['50 lists by indentation', indentedBullets(50), false],
  ['51 lists by indentation', indentedBullets(51), true],
  ['25 quotes in 25 lists', `${'> - '.repeat(25)}x\n`, false],
  ['26 quotes in 26 lists', `${'> - '.repeat(26)}x\n`, true],
  [
    '50 quotes with 60 levels of emphasis, which the rule leaves to the rendering',
    `${'> '.repeat(50)}${nestedEmphasis(60)}`,
    false,
  ],
  ['many sibling lists', '- a\n\n'.repeat(5000), false],
  ['a line of 100 markers that is a rule, not a nest', `${'* '.repeat(100)}\n`, false],
])('isNestedTooDeeply: %s -> %s', (_label, text, tooDeep) => {
  expect(isNestedTooDeeply(text)).toBe(tooDeep);
});

test.each([
  ['100 quotes', '> '.repeat(100), false],
  ['101 quotes', '> '.repeat(101), true],
  ['101 quotes without spaces', '>'.repeat(101), true],
  ['101 bullets', '- '.repeat(101), true],
  ['101 pluses and stars', '+ * '.repeat(51), true],
  ['101 ordered markers with a dot', '1. '.repeat(101), true],
  ['101 ordered markers with a parenthesis', '12) '.repeat(101), true],
  ['101 markers by tab', '-\t'.repeat(101), true],
  ['101 markers in a row, indented', `   ${'> '.repeat(101)}`, true],
  ['101 markers on the second line', `a\n${'> '.repeat(101)}`, true],
  ['101 markers on the last line after CRLF', `a\r\n${'> '.repeat(101)}`, true],
  ['101 markers on a line after a lone CR', `a\r${'> '.repeat(101)}`, true],
  ['50 markers on each of many lines', `${'> '.repeat(50)}x\n`.repeat(100), false],
  ['100 markers and then text', `${'> '.repeat(100)}x`, false],
  ['101 markers, the last a bullet with nothing after it', `${'> '.repeat(100)}-`, true],
  ['a marker after text is not at the start of the line', `x${'> '.repeat(101)}`, false],
  ['a bullet glued to a word is not a marker', '-a'.repeat(101), false],
  ['a number of ten digits is not a marker', '1234567890. '.repeat(101), false],
  ['a number with no delimiter is not a marker', '1 '.repeat(101), false],
  ['nothing', '', false],
  ['an empty line', '\n\n', false],
])('opensTooManyContainers: %s -> %s', (_label, text, runaway) => {
  expect(opensTooManyContainers(text)).toBe(runaway);
});

test.each(MARKER_RUNS)(
  'a text of 100 KiB of %s as container markers is refused in time linear in its size',
  (_label, build) => {
    expect(isNestedTooDeeply(build(102_400))).toBe(true);
    expect(slowdownOf(isNestedTooDeeply, build, 102_400)).toBeLessThan(MOST_LINEAR_SLOWDOWN);
  },
);

test('a text of 100 KiB of [ or * is no deeper than any other text', () => {
  expect(isNestedTooDeeply('['.repeat(102_400))).toBe(false);
  expect(isNestedTooDeeply('*'.repeat(102_400))).toBe(false);
  expect(isNestedTooDeeply('*a '.repeat(34_000))).toBe(false);
});
