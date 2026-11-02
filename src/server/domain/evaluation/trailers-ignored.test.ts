// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { coAuthoredBy, messageEndingWith, noreplyEmail } from './test-support.ts';
import { IGNORED_TRAILER_IDENTITIES, isIgnoredTrailerEmail } from './trailer-identities.ts';
import { parseCoAuthors } from './trailers.ts';

// E08-S06: bot and AI trailers are ignored before resolution and give neither an actor nor an advisory, and a hostile
// name never changes a result. Each row is the email of one trailer and whether it is ignored.

const NONE = { githubIds: [], advisories: [] };

test.each([
  ['a [bot] login with an id', '49699333+dependabot[bot]@users.noreply.github.com', true],
  ['a [bot] login in upper case', '49699333+Renovate[BOT]@users.noreply.github.com', true],
  ['a [bot] login without an id', 'dependabot[bot]@users.noreply.github.com', true],
  [
    'a [bot] login with an id of 0 (ignored before the id is looked at)',
    '0+dependabot[bot]@users.noreply.github.com',
    true,
  ],
  [
    'a [bot] login of 60 characters (ignored before the length is looked at)',
    `1+${'a'.repeat(60)}[bot]@users.noreply.github.com`,
    true,
  ],
  ['a [bot] login on the domain in upper case', '1+x[bot]@USERS.NOREPLY.GITHUB.COM', true],
  ['[bot] in the middle of a login is not the suffix', '12+a[bot]b@users.noreply.github.com', false],
  ['[bot] on an address that is not a noreply address', 'renovate[bot]@example.org', false],
  ['the AI address of Claude Code', 'noreply@anthropic.com', true],
  ['the AI address in other cases', 'NoReply@Anthropic.COM', true],
  ['an address that only starts like the AI address', 'noreply@anthropic.com.evil.example', false],
  ['another address at the same domain', 'ada@anthropic.com', false],
  ['the same local part at another domain', 'noreply@example.org', false],
  ['GitHub Copilot with its first id', '175728472+Copilot@users.noreply.github.com', true],
  ['GitHub Copilot with its second id', '223556219+Copilot@users.noreply.github.com', true],
  ['GitHub Copilot with any other id and another case', '5+COPILOT@users.noreply.github.com', true],
  ['GitHub Copilot in the legacy form', 'Copilot@users.noreply.github.com', true],
  ['a login that merely starts with copilot', '12+copilot2@users.noreply.github.com', false],
  ['a login that merely ends with copilot', '12+notcopilot@users.noreply.github.com', false],
  ['copilot at another domain', '12+Copilot@example.org', false],
  ['a person', noreplyEmail(12, 'ada'), false],
  ['the empty string', '', false],
] as const)('isIgnoredTrailerEmail: %s', (_name, email, ignored) => {
  expect(isIgnoredTrailerEmail(email)).toBe(ignored);
});

test.each([
  ['a [bot] trailer', coAuthoredBy('49699333+dependabot[bot]@users.noreply.github.com', 'dependabot[bot]')],
  ['a Claude trailer', coAuthoredBy('noreply@anthropic.com', 'Claude', 'Co-Authored-By')],
  ['a Copilot trailer', coAuthoredBy('175728472+Copilot@users.noreply.github.com', 'Copilot')],
] as const)('%s gives neither an id nor an advisory', (_name, trailer) => {
  expect(parseCoAuthors(messageEndingWith(trailer))).toEqual(NONE);
});

test('an ignored trailer does not hide the person next to it', () => {
  const message = messageEndingWith(
    coAuthoredBy('noreply@anthropic.com', 'Claude'),
    coAuthoredBy(noreplyEmail(12, 'ada'), 'Ada'),
    coAuthoredBy('49699333+dependabot[bot]@users.noreply.github.com', 'dependabot[bot]'),
  );
  expect(parseCoAuthors(message)).toEqual({ githubIds: [12], advisories: [] });
});

test('the table of ignored identities is lower case, so one comparison covers every spelling', () => {
  expect(IGNORED_TRAILER_IDENTITIES).toEqual([
    { kind: 'address', value: 'noreply@anthropic.com' },
    { kind: 'noreply_login', value: 'copilot' },
  ]);
  for (const identity of IGNORED_TRAILER_IDENTITIES) {
    expect(identity.value).toBe(identity.value.toLowerCase());
  }
});

/** U+202E, the right-to-left override that makes `exe.live` read as `evil.exe`. Built from its code point on purpose. */
const RTL_OVERRIDE = String.fromCodePoint(0x202e);

const HOSTILE_NAMES = [
  'Ada',
  '**[click](https://evil.example)**',
  '@everyone @octocat',
  'fixes #12 closes #1',
  `Ada ${RTL_OVERRIDE}evil.exe`,
  '`code` <b>bold</b> & <script>alert(1)</script>',
  'x'.repeat(10_000),
  `${noreplyEmail(99, 'victim')} <${noreplyEmail(98, 'other')}>`,
  'Co-authored-by: Mallory',
  String.fromCodePoint(0, 0x200b, 0xfeff),
];

test.each(HOSTILE_NAMES.map((name) => [name.slice(0, 40), name] as const))(
  'a hostile name changes no result: %s',
  (_label, name) => {
    const plain = parseCoAuthors(messageEndingWith(coAuthoredBy(noreplyEmail(12, 'ada'), 'Ada')));
    const hostile = parseCoAuthors(messageEndingWith(coAuthoredBy(noreplyEmail(12, 'ada'), name)));
    expect(hostile).toEqual(plain);
    expect(hostile).toEqual({ githubIds: [12], advisories: [] });
  },
);

test.each(HOSTILE_NAMES.map((name) => [name.slice(0, 40), name] as const))(
  'a hostile name on an unresolved or ignored address leaks nowhere: %s',
  (_label, name) => {
    const unresolved = parseCoAuthors(messageEndingWith(coAuthoredBy('ada@example.org', name)));
    const ignored = parseCoAuthors(messageEndingWith(coAuthoredBy('noreply@anthropic.com', name)));
    expect(unresolved).toEqual({ githubIds: [], advisories: ['co_author_unresolved'] });
    expect(ignored).toEqual(NONE);
  },
);
