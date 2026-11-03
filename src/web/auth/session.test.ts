// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { avatarUrlSchema } from './session.ts';

// E17-S08: an avatar address is accepted only on GitHub's avatar host over HTTPS; everything else falls back to initials.

test.each([
  ['an avatar of a user', 'https://avatars.githubusercontent.com/u/4711?v=4'],
  ['an avatar without a query', 'https://avatars.githubusercontent.com/u/4711'],
  ['the explicit default port', 'https://avatars.githubusercontent.com:443/u/4711'],
])('%s is accepted as it is', (_what, url) => {
  expect(avatarUrlSchema.parse(url)).toBe(url);
});

test.each([
  ['a look-alike host', 'https://avatars.githubusercontent.com.evil.example/u/1'],
  ['the avatar host as a user name', 'https://avatars.githubusercontent.com@evil.example/u/1'],
  ['credentials on the avatar host', 'https://user:pw@avatars.githubusercontent.com/u/1'],
  ['a user name on the avatar host', 'https://user@avatars.githubusercontent.com/u/1'],
  ['plain HTTP', 'https://avatars.githubusercontent.com/u/1'.replace('https:', 'http:')],
  ['another port', 'https://avatars.githubusercontent.com:8443/u/1'],
  ['a sub-domain', 'https://sub.avatars.githubusercontent.com/u/1'],
  ['another GitHub host', 'https://github.com/octocat.png'],
  ['a script address', 'javascript:alert(1)'],
  ['a data address', 'data:image/svg+xml,<svg/>'],
  ['a protocol-relative address', '//avatars.githubusercontent.com/u/1'],
  ['a relative path', '/u/1'],
  ['an empty string', ''],
  ['text that is no address', 'not a url'],
  ['the host in upper case with a look-alike suffix', 'https://AVATARS.GITHUBUSERCONTENT.COM.EVIL.EXAMPLE/u/1'],
])('%s becomes null, which the avatar shows as initials', (_what, url) => {
  expect(avatarUrlSchema.parse(url)).toBeNull();
});

test('no avatar stays no avatar, and a value that is no string at all is null too', () => {
  expect(avatarUrlSchema.parse(null)).toBeNull();
  expect(avatarUrlSchema.parse(42)).toBeNull();
  expect(avatarUrlSchema.parse(undefined)).toBeNull();
});
