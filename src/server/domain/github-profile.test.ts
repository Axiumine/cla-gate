// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { avatarOrNull, cutName, LOGIN_PATTERN, type ReportedEmail, verifiedOnly } from './github-profile.ts';

// The bounds the login puts on a GitHub account's display data (E10-S05).

test.each(['a', 'octocat', 'Octo-Cat', 'a-b-c', '0', '9lives', 'a'.repeat(39)])('%s is a login', (login) => {
  expect(LOGIN_PATTERN.test(login)).toBe(true);
});

test.each([
  ['empty', ''],
  ['a leading hyphen', '-octocat'],
  ['40 characters', 'a'.repeat(40)],
  ['an underscore', 'octo_cat'],
  ['a bracket (a bot)', 'dependabot[bot]'],
  ['a space', 'octo cat'],
  ['a newline at the end', 'octocat\n'],
  ['a dot', 'octo.cat'],
  ['a non-ASCII letter', 'octocät'],
  ['markup', '<script>'],
])('%s is not a login', (_label, login) => {
  expect(LOGIN_PATTERN.test(login)).toBe(false);
});

test('a name of 255 characters is kept whole and one of 256 is cut to 255', () => {
  expect(cutName('n'.repeat(255))).toBe('n'.repeat(255));
  expect(cutName('n'.repeat(256))).toBe('n'.repeat(255));
  expect(cutName('n'.repeat(5000))).toHaveLength(255);
});

test('a name is cut by code points, so an emoji at the boundary is never split', () => {
  const emoji = String.fromCodePoint(0x1f600);
  expect(cutName(emoji.repeat(300))).toBe(emoji.repeat(255));
  expect(cutName(`${'a'.repeat(254)}${emoji}${emoji}`)).toBe(`${'a'.repeat(254)}${emoji}`);
});

test.each([
  ['an empty name', ''],
  ['markup', '<img src=x onerror=alert(1)>'],
  ['a formula', '=HYPERLINK("http://evil.example","x")'],
  ['a mention', '@everyone'],
  ['spaces around', '  Octo Cat  '],
])('%s is stored as it is', (_label, name) => {
  expect(cutName(name)).toBe(name);
});

test.each([
  [
    'an avatar',
    'https://avatars.githubusercontent.com/u/583231?v=4',
    'https://avatars.githubusercontent.com/u/583231?v=4',
  ],
  ['the default port', 'https://avatars.githubusercontent.com:443/u/1', 'https://avatars.githubusercontent.com/u/1'],
  ['credentials', 'https://user:pw@avatars.githubusercontent.com/u/1', 'https://avatars.githubusercontent.com/u/1'],
  ['a fragment', 'https://avatars.githubusercontent.com/u/1#frag', 'https://avatars.githubusercontent.com/u/1'],
  ['a line break inside', 'https://avatars.githubusercontent.com/u/\n1', 'https://avatars.githubusercontent.com/u/1'],
])('%s on the avatar host is kept: %s', (_label, raw, kept) => {
  expect(avatarOrNull(raw)).toBe(kept);
});

test.each([
  ['null', null],
  ['another host', 'https://evil.example/u/1'],
  ['a look-alike sub-domain', 'https://avatars.githubusercontent.com.evil.example/u/1'],
  ['the avatar host as user name', 'https://avatars.githubusercontent.com@evil.example/u/1'],
  ['a sibling sub-domain', 'https://camo.githubusercontent.com/u/1'],
  ['plain HTTP', 'https://avatars.githubusercontent.com/u/1'.replace('https:', 'http:')],
  ['another port', 'https://avatars.githubusercontent.com:8443/u/1'],
  ['a data URL', 'data:image/png;base64,AAAA'],
  ['a script URL', 'javascript:alert(1)'],
  ['not a URL', 'avatar.png'],
  ['empty', ''],
  [
    '2049 characters',
    `https://avatars.githubusercontent.com/${'a'.repeat(2049 - 'https://avatars.githubusercontent.com/'.length)}`,
  ],
])('%s is stored as null', (_label, raw) => {
  expect(avatarOrNull(raw)).toBeNull();
});

test('an avatar address of exactly 2048 characters is kept', () => {
  const prefix = 'https://avatars.githubusercontent.com/';
  const raw = `${prefix}${'a'.repeat(2048 - prefix.length)}`;
  expect(avatarOrNull(raw)).toBe(raw);
});

const address = (email: string, primary: boolean, verified: boolean): ReportedEmail => ({ email, primary, verified });

test('only verified addresses are kept, in the reported order, with the primary flag and without the verified flag', () => {
  const reported = [
    address('Primary@Example.org', true, true),
    address('unverified@example.org', false, false),
    address('other@example.org', false, true),
  ];
  expect(verifiedOnly(reported)).toEqual([
    { email: 'Primary@Example.org', primary: true },
    { email: 'other@example.org', primary: false },
  ]);
});

test('no verified address gives an empty list', () => {
  expect(verifiedOnly([address('a@example.org', true, false)])).toEqual([]);
  expect(verifiedOnly([])).toEqual([]);
});

test('at most 20 addresses are kept, the first 20 verified ones', () => {
  const many = Array.from({ length: 30 }, (_unused, index) =>
    address(`a${index}@example.org`, index === 0, index % 5 !== 1),
  );
  const kept = verifiedOnly(many);
  expect(kept).toHaveLength(20);
  expect(kept[0]).toEqual({ email: 'a0@example.org', primary: true });
  expect(kept.at(-1)).toEqual({ email: 'a24@example.org', primary: false });
  expect(kept.map((entry) => entry.email)).not.toContain('a1@example.org');
  expect(kept.map((entry) => entry.email)).not.toContain('a25@example.org');
});
