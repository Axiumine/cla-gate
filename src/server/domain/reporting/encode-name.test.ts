// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { renderName } from './encode.ts';
import { codePointCount, isOneCodeSpan, ZWSP } from './test-support.ts';

// E09-S01, renderName: a name is cleaned in a fixed order (well-formed text, controls out, whitespace collapsed, trimmed,
// cut to 64 code points, mentions broken) and then wrapped in exactly one code span. The expected texts are written out, so a
// change of the order or of a limit shows up as a different string.

const FFFD = '\u{fffd}';
const EMOJI = String.fromCodePoint(0x1f600);
/** Characters of the tag block U+E0000 to U+E007F, and the two just outside the ends of what is removed. */
const TAG_FIRST = String.fromCodePoint(0xe0000);
const TAG_A = String.fromCodePoint(0xe0041);
const TAG_LAST = String.fromCodePoint(0xe007f);
const AFTER_TAGS = String.fromCodePoint(0xe0080);
const VS17 = String.fromCodePoint(0xe0100);

test.each([
  ['a plain login', 'octocat', '`octocat`'],
  ['a name with a space', 'Jane Doe', '`Jane Doe`'],
  ['a lone high surrogate', 'a\uD800b', `\`a${FFFD}b\``],
  ['a lone low surrogate', 'a\uDC00b', `\`a${FFFD}b\``],
  ['a surrogate pair is a character, not two lone halves', `a${EMOJI}b`, `\`a${EMOJI}b\``],
  ['a NUL and a unit separator', 'a\u0000b\u001Fc', '`abc`'],
  ['a tab, a line feed and a carriage return', 'a\tb\nc\rd', '`abcd`'],
  ['DEL and the C1 controls', 'a\u007Fb\u0080c\u009Fd', '`abcd`'],
  ['a line separator and a paragraph separator', 'a\u{2028}b\u{2029}c', '`abc`'],
  ['the bidi embeddings and the override', 'a\u{202a}b\u{202b}c\u{202c}d\u{202d}e\u{202e}f', '`abcdef`'],
  ['the bidi isolates', 'a\u{2066}b\u{2067}c\u{2068}d\u{2069}e', '`abcde`'],
  ['a left-to-right mark', 'a\u{200e}b', '`ab`'],
  ['a right-to-left mark', 'a\u{200f}b', '`ab`'],
  ['an Arabic letter mark', 'a\u{61c}b', '`ab`'],
  ['a tag letter, which draws nothing and can carry hidden text', `x${TAG_A}y`, '`xy`'],
  ['the first and the last character of the tag block', `x${TAG_FIRST}${TAG_LAST}y`, '`xy`'],
  ['a name made only of tag characters', `${TAG_A}${TAG_LAST}`, '`(unnamed)`'],
  ['a character just after the tag block is kept', `x${AFTER_TAGS}y`, `\`x${AFTER_TAGS}y\``],
  ['a variation selector of the supplement is kept, it is part of a character', `x${VS17}y`, `\`x${VS17}y\``],
  ['a fake list item', '\n- [x] Signed', '`- [x] Signed`'],
  ['a fake heading', '\r\n## Passed', `\`#${ZWSP}#${ZWSP} Passed\``],
])('renderName cleans %s', (_what, raw, expected) => {
  expect(renderName(raw)).toBe(expected);
});

test.each([
  ['a run of spaces', 'a   b', '`a b`'],
  ['no-break and ideographic spaces', 'a\u{a0}\u{a0}b\u{3000}c', '`a b c`'],
  ['a mixed run', 'a \u{a0}\u{2003} b', '`a b`'],
  ['spaces at both ends', '   x   ', '`x`'],
  ['a control between two spaces is removed first, so the spaces are one run', 'a \u0000 b', '`a b`'],
  ['a control between two letters leaves no space', 'a\u0000b', '`ab`'],
  ['a zero-width space is not whitespace', `a${ZWSP}b`, `\`a${ZWSP}b\``],
])('renderName handles whitespace: %s', (_what, raw, expected) => {
  expect(renderName(raw)).toBe(expected);
});

test.each([
  ['an @', '@octocat', `\`@${ZWSP}octocat\``],
  ['a #', '#1', `\`#${ZWSP}1\``],
  ['a repository reference', 'org/repo#1', `\`org/repo#${ZWSP}1\``],
  ['a team mention', '@org/team', `\`@${ZWSP}org/team\``],
  ['two marks in a row', '@#', `\`@${ZWSP}#${ZWSP}\``],
  ['a mark at the end', 'x@', `\`x@${ZWSP}\``],
  ['an email-shaped name', 'a@b.co', `\`a@${ZWSP}b.co\``],
])('renderName breaks %s inside the span', (_what, raw, expected) => {
  expect(renderName(raw)).toBe(expected);
});

test.each([
  ['no backtick', 'abc', '`abc`'],
  ['one inside', 'a`b', '``a`b``'],
  ['a run of three', 'a```b', '````a```b````'],
  ['the longest of two runs', 'a` ``b', '```a` ``b```'],
  ['one at the start', '`a', '`` `a ``'],
  ['one at the end', 'a`', '`` a` ``'],
  ['one at both ends', '`a`', '`` `a` ``'],
  ['nothing else', '`', '`` ` ``'],
  ['a triple fence', '```', '```` ``` ````'],
])('renderName fences a name with %s', (_what, raw, expected) => {
  expect(renderName(raw)).toBe(expected);
  expect(isOneCodeSpan(expected)).toBe(true);
});

test.each([
  ['nothing', ''],
  ['spaces', '   '],
  ['only controls', '\u0000\u001F\u007F\u0085'],
  ['only a bidi override', '\u{202e}'],
  ['only line breaks', '\n\r\n\u{2028}'],
])('renderName shows (unnamed) for %s', (_what, raw) => {
  expect(renderName(raw)).toBe('`(unnamed)`');
});

test('a lone surrogate is a character of the name, not nothing: it becomes U+FFFD', () => {
  expect(renderName('\uD800')).toBe(`\`${FFFD}\``);
});

test.each([
  ['64 characters stay whole', 'n'.repeat(64), `\`${'n'.repeat(64)}\``],
  ['65 characters are cut to 64 and marked', 'n'.repeat(65), `\`${'n'.repeat(64)}…\``],
  ['64 emoji stay whole, though they are 128 UTF-16 units', EMOJI.repeat(64), `\`${EMOJI.repeat(64)}\``],
  ['65 emoji are cut to 64 whole emoji', EMOJI.repeat(65), `\`${EMOJI.repeat(64)}…\``],
  ['a name of ten thousand characters', 'x'.repeat(10_000), `\`${'x'.repeat(64)}…\``],
  ['a cut after a space keeps the space', `${'a'.repeat(63)} bcd`, `\`${'a'.repeat(63)} …\``],
  ['controls do not count toward the 64', 'a\u0000'.repeat(64), `\`${'a'.repeat(64)}\``],
  ['collapsed spaces count once', 'a  '.repeat(32).trimEnd(), `\`${'a '.repeat(31)}a\``],
])('renderName cuts to 64 code points: %s', (_what, raw, expected) => {
  expect(renderName(raw)).toBe(expected);
});

test('the zero-width spaces that break mentions do not count toward the 64', () => {
  const mention = `@${ZWSP}`;
  expect(renderName('@'.repeat(64))).toBe(`\`${mention.repeat(64)}\``);
  expect(renderName('@'.repeat(65))).toBe(`\`${mention.repeat(64)}…\``);
});

test('a mark at the cut still gets its zero-width space, before the ellipsis', () => {
  const raw = `${'a'.repeat(63)}@bcd`;
  expect(renderName(raw)).toBe(`\`${'a'.repeat(63)}@${ZWSP}…\``);
});

test('a name of backticks is cut, marked, fenced longer than its longest run and padded', () => {
  const rendered = renderName('`'.repeat(100));
  expect(rendered).toBe(`${'`'.repeat(65)} ${'`'.repeat(64)}… ${'`'.repeat(65)}`);
  expect(isOneCodeSpan(rendered)).toBe(true);
});

test('a cut name that ends in backticks is not padded, because the ellipsis is its end', () => {
  const rendered = renderName(`x${'`'.repeat(70)}`);
  expect(rendered).toBe(`${'`'.repeat(64)}x${'`'.repeat(63)}…${'`'.repeat(64)}`);
  expect(isOneCodeSpan(rendered)).toBe(true);
  expect(codePointCount(rendered)).toBe(64 + 1 + 63 + 1 + 64);
});

test.each([
  [
    'the comment marker of E09-S07',
    '<!-- cla-platform:license/cla:v1 -->',
    `\`<${ZWSP}!-- cla-platform:license/cla:v1 -->\``,
  ],
  ['an opener and nothing else', '<!--', `\`<${ZWSP}!--\``],
  ['each of two openers', 'a<!--b<!--c', `\`a<${ZWSP}!--b<${ZWSP}!--c\``],
  ['an opener after a bracket', '<<!--', `\`<<${ZWSP}!--\``],
  ['a bracket and a bang that are not an opener', '<!- -> <! --', '`<!- -> <! --`'],
])('renderName splits an HTML comment opener so a name never spells the marker: %s', (_what, raw, expected) => {
  expect(renderName(raw)).toBe(expected);
  expect(renderName(raw)).not.toContain('<!--');
});
