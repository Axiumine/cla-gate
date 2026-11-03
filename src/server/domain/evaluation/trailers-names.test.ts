// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { coAuthoredBy, messageEndingWith, noreplyEmail } from './test-support.ts';
import { MAX_TRAILERS_PER_COMMIT, parseCoAuthors, unresolvedCoAuthorNames } from './trailers.ts';

// E09-S03: the names of the trailers that parseCoAuthors reports as `co_author_unresolved`, for the advisory list of the
// reporter. Exactly those trailers have a name here, and the address is never part of one.

const RESOLVED = coAuthoredBy(noreplyEmail(12, 'ada'), 'Ada');
const BOT = coAuthoredBy('49699333+dependabot[bot]@users.noreply.github.com', 'dependabot[bot]');
const AI = coAuthoredBy('noreply@anthropic.com', 'Claude', 'Co-Authored-By');

test.each([
  ['an address that is not a noreply address', 'Co-authored-by: Jane Roe <jane@example.org>', ['Jane Roe']],
  ['the legacy noreply form without an id', coAuthoredBy('ada@users.noreply.github.com', 'Ada'), ['Ada']],
  ['a name with spaces around it', 'Co-authored-by:    Jane   Roe   <jane@example.org>', ['Jane   Roe']],
  ['an empty name', 'Co-authored-by: <jane@example.org>', ['']],
  [
    'the last bracket group is the address, so the first is part of the name',
    'Co-authored-by: Jane <x> <y@z>',
    ['Jane <x>'],
  ],
  ['no closing bracket', 'Co-authored-by: Jane Roe <jane@example.org', ['Jane Roe']],
  ['text after the closing bracket', 'Co-authored-by: Jane Roe <jane@example.org> and more', ['Jane Roe']],
  ['no angle brackets at all, so a bare address is never taken for a name', 'Co-authored-by: jane@example.org', ['']],
  ['no angle brackets and no address', 'Co-authored-by: Jane Roe', ['']],
  ['a hostile name, kept as it is for the encoder to make safe', 'Co-authored-by: @everyone <x@y.z>', ['@everyone']],
] as const)('%s gives its name', (_what, trailer, names) => {
  expect(unresolvedCoAuthorNames(messageEndingWith(trailer))).toEqual(names);
});

test('a trailer that resolves to an account, a bot trailer and an AI trailer give no name', () => {
  expect(unresolvedCoAuthorNames(messageEndingWith(RESOLVED, BOT, AI))).toEqual([]);
});

test('the names come in the order written, and a resolved or ignored trailer between them is skipped', () => {
  const message = messageEndingWith(
    'Co-authored-by: First <a@example.org>',
    RESOLVED,
    BOT,
    'Co-authored-by: Second <b@example.org>',
  );
  expect(unresolvedCoAuthorNames(message)).toEqual(['First', 'Second']);
});

test('a message without a trailer, a trailer outside the final paragraph and an empty message give no name', () => {
  expect(unresolvedCoAuthorNames('')).toEqual([]);
  expect(unresolvedCoAuthorNames('Subject\n\nBody.')).toEqual([]);
  expect(
    unresolvedCoAuthorNames(`${messageEndingWith('Co-authored-by: A <a@example.org>')}\n\nClosing words.`),
  ).toEqual([]);
});

test('only the trailers up to the limit are read, as parseCoAuthors reads them', () => {
  const trailers = Array.from(
    { length: MAX_TRAILERS_PER_COMMIT + 5 },
    (_unused, index) => `Co-authored-by: P${index} <p${index}@example.org>`,
  );
  const message = messageEndingWith(...trailers);
  const names = unresolvedCoAuthorNames(message);
  expect(names).toHaveLength(MAX_TRAILERS_PER_COMMIT);
  expect(names.at(-1)).toBe(`P${MAX_TRAILERS_PER_COMMIT - 1}`);
  expect(parseCoAuthors(message).advisories).toEqual([
    ...Array.from({ length: MAX_TRAILERS_PER_COMMIT }, () => 'co_author_unresolved'),
    'too_many_trailers',
  ]);
});

test('the count of names is the count of co_author_unresolved advisories of parseCoAuthors, for any mix of trailers', () => {
  const message = messageEndingWith(
    RESOLVED,
    'Co-authored-by: One <1@example.org>',
    BOT,
    'Co-authored-by: Two',
    AI,
    'Co-authored-by: Three <3@users.noreply.github.com>',
  );
  const unresolved = parseCoAuthors(message).advisories.filter((code) => code === 'co_author_unresolved');
  expect(unresolvedCoAuthorNames(message)).toHaveLength(unresolved.length);
});
