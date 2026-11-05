// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { InvalidSignLinkError } from '../../shared/sign-link.ts';
import { badgeSnippet } from './badge-snippet.ts';

// The snippet of E22-S03 (the route that sends it is tested in badge-snippet-routes*.test.ts).

test('the snippet is the project badge as an image inside a link to the sign page of the repository, in Markdown and in HTML', () => {
  expect(badgeSnippet('https://cla.example.org', 4242)).toEqual({
    markdown:
      '[![CLA: required](https://cla.example.org/api/public/repos/4242/badge.svg)](https://cla.example.org/sign/4242)',
    html: '<a href="https://cla.example.org/sign/4242"><img src="https://cla.example.org/api/public/repos/4242/badge.svg" alt="CLA: required"></a>',
  });
});

test('the snippet is built on the origin it is given, a port and an IPv6 literal included', () => {
  expect(badgeSnippet('http://localhost:3000', 9).markdown).toBe(
    '[![CLA: required](http://localhost:3000/api/public/repos/9/badge.svg)](http://localhost:3000/sign/9)',
  );
  expect(badgeSnippet('http://[::1]:8080', 9).html).toContain('href="http://[::1]:8080/sign/9"');
});

test.each([
  ['a path', 'https://cla.example.org/app'],
  ['a closing bracket that would end the link', 'https://cla.example.org)'],
  ['a quote that would end the attribute', 'https://cla.example.org"'],
  ['nothing', ''],
])('an address with %s makes no snippet, so nothing but an origin ever reaches a README', (_what, origin) => {
  expect(() => badgeSnippet(origin, 9)).toThrow(new InvalidSignLinkError('base URL'));
});

test.each([[0], [-1], [1.5], [Number.NaN]])('a repository id of %s makes no snippet', (id) => {
  expect(() => badgeSnippet('https://cla.example.org', id)).toThrow(new InvalidSignLinkError('repository id'));
});
