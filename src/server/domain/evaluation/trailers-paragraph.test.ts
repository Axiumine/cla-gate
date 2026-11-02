// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { coAuthoredBy, messageEndingWith, noreplyEmail } from './test-support.ts';
import { MAX_TRAILERS_PER_COMMIT, parseCoAuthors } from './trailers.ts';
import type { AdvisoryCode } from './types.ts';

// E08-S06: which lines of a commit message are `Co-authored-by` trailers. Each row hands a whole message to
// parseCoAuthors and names the ids that resolve and the advisories. The forms of the email are in
// trailers-resolution.test.ts and the ignored bot and AI trailers in trailers-ignored.test.ts.

const A = coAuthoredBy(noreplyEmail(12, 'ada'));
const B = coAuthoredBy(noreplyEmail(13, 'bob'));
const LEGACY = coAuthoredBy('ada@users.noreply.github.com');

const rows: readonly (readonly [name: string, message: string, ids: readonly number[], advisories: AdvisoryCode[]])[] =
  [
    ['the key in lower case', messageEndingWith(coAuthoredBy(noreplyEmail(12), 'A', 'co-authored-by')), [12], []],
    ['the key as GitHub writes it', messageEndingWith(coAuthoredBy(noreplyEmail(12), 'A', 'Co-authored-by')), [12], []],
    [
      'the key as Claude Code writes it',
      messageEndingWith(coAuthoredBy(noreplyEmail(12), 'A', 'Co-Authored-By')),
      [12],
      [],
    ],
    ['the key in upper case', messageEndingWith(coAuthoredBy(noreplyEmail(12), 'A', 'CO-AUTHORED-BY')), [12], []],
    ['two trailers in the order written', messageEndingWith(A, B), [12, 13], []],
    ['the same id twice is kept twice (the merge by id happens later)', messageEndingWith(A, A), [12, 12], []],
    ['a trailer in a non-final paragraph is not read', `${messageEndingWith(A)}\n\nClosing words.`, [], []],
    ['only the final paragraph of two with trailers is read', `${messageEndingWith(A)}\n\n${B}`, [13], []],
    ['a trailer that is the whole message is in the final paragraph', A, [12], []],
    ['a message that ends in a newline still has its trailers', `${messageEndingWith(A)}\n`, [12], []],
    ['a message that ends in blank lines still has its trailers', `${messageEndingWith(A)}\n\n  \n\t\n`, [12], []],
    ['a line of spaces and tabs is a blank line', `Subject\n\n${A}\n \t \n${B}`, [13], []],
    ['CRLF line endings', `Subject\r\n\r\nBody\r\n\r\n${A}\r\n${B}\r\n`, [12, 13], []],
    ['CRLF between a trailer and the paragraph before it', `${A}\r\n\r\n${B}`, [13], []],
    [
      'other trailers in the paragraph are not ours',
      messageEndingWith('Signed-off-by: Ada <ada@example.org>', B),
      [13],
      [],
    ],
    ['no space after the colon', messageEndingWith(`Co-authored-by:Ada <${noreplyEmail(12)}>`), [12], []],
    ['many spaces around the value', messageEndingWith(`Co-authored-by:     Ada <${noreplyEmail(12)}>   `), [12], []],
    ['the key without a colon is not a trailer', messageEndingWith(`Co-authored-by Ada <${noreplyEmail(12)}>`), [], []],
    [
      'a space before the colon is not the key',
      messageEndingWith(`Co-authored-by : Ada <${noreplyEmail(12)}>`),
      [],
      [],
    ],
    ['a longer key is not the key', messageEndingWith(`Co-authored-by-someone: Ada <${noreplyEmail(12)}>`), [], []],
    ['a key with a prefix is not the key', messageEndingWith(`Not-Co-authored-by: Ada <${noreplyEmail(12)}>`), [], []],
    ['an indented line is not a trailer', messageEndingWith(` ${A}`), [], []],
    ['a trailer after text in the same paragraph is read', messageEndingWith(`Thanks to all.\n${A}`), [12], []],
    ['a trailer with no value is unresolved', messageEndingWith('Co-authored-by:'), [], ['co_author_unresolved']],
    [
      'a legacy trailer and a resolved one: one advisory and one id',
      messageEndingWith(LEGACY, B),
      [13],
      ['co_author_unresolved'],
    ],
    [
      'three unresolved trailers give three advisories',
      messageEndingWith(LEGACY, LEGACY, 'Co-authored-by: nobody'),
      [],
      ['co_author_unresolved', 'co_author_unresolved', 'co_author_unresolved'],
    ],
    ['an empty message', '', [], []],
    ['a message of blank lines only', '\n \n\t\n', [], []],
    ['a subject only', 'Fix the thing', [], []],
  ];

test.each(rows)('%s', (_name, message, ids, advisories) => {
  expect(parseCoAuthors(message)).toEqual({ githubIds: ids, advisories });
});

const many = (count: number): string[] =>
  Array.from({ length: count }, (_unused, i) => coAuthoredBy(noreplyEmail(100 + i, `user${i}`)));
const ids = (count: number): number[] => Array.from({ length: count }, (_unused, i) => 100 + i);

test('the limit is 20 trailers per commit', () => {
  expect(MAX_TRAILERS_PER_COMMIT).toBe(20);
});

test.each([
  ['19 trailers: all read', 19, ids(19), []],
  ['20 trailers: all read, no advisory', 20, ids(20), []],
  ['21 trailers: 20 read and one too_many_trailers', 21, ids(20), ['too_many_trailers']],
  ['5,000 trailers: still 20 read and a single advisory', 5000, ids(20), ['too_many_trailers']],
] as const)('%s', (_name, count, expectedIds, advisories) => {
  expect(parseCoAuthors(messageEndingWith(...many(count)))).toEqual({ githubIds: expectedIds, advisories });
});

test('trailers beyond the limit are not read, so unresolved ones among them add nothing', () => {
  const lines = [...many(20), LEGACY, LEGACY, ...many(3)];
  expect(parseCoAuthors(messageEndingWith(...lines))).toEqual({
    githubIds: ids(20),
    advisories: ['too_many_trailers'],
  });
});

test('unresolved and ignored trailers count towards the limit, so the limit bounds the work and not just the ids', () => {
  const bots = Array.from({ length: 10 }, () => coAuthoredBy('noreply@anthropic.com', 'Claude'));
  const lines = [...bots, ...Array.from({ length: 10 }, () => LEGACY), A];
  expect(parseCoAuthors(messageEndingWith(...lines))).toEqual({
    githubIds: [],
    advisories: [...Array.from({ length: 10 }, () => 'co_author_unresolved'), 'too_many_trailers'],
  });
});

test('lines that are not trailers do not count towards the limit', () => {
  const noise = Array.from({ length: 50 }, (_unused, i) => `Reviewed-by: person ${i}`);
  expect(parseCoAuthors(messageEndingWith(...noise, ...many(20)))).toEqual({ githubIds: ids(20), advisories: [] });
});
