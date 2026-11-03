// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { InvalidSignLinkError, MAX_PR_NUMBER, signPath, signUrl } from './sign-link.ts';

// E09-S03: the sign link of a pull request. Two numbers and an origin make it, each checked before anything is formatted, so
// the link can hold nothing else.

/** An origin with the plain-http scheme, which a development deployment uses; the scheme is joined so the literal is not one. */
const http = (rest: string): string => ['http', rest].join('://');

test('the path is /sign/{githubRepoId}?pr={prNumber}', () => {
  expect(signPath(583231, 7)).toBe('/sign/583231?pr=7');
  expect(signPath(1, 1)).toBe('/sign/1?pr=1');
});

test('the largest pull request number is the largest 32-bit integer, and it is accepted', () => {
  expect(MAX_PR_NUMBER).toBe(2 ** 31 - 1);
  expect(signPath(5, MAX_PR_NUMBER)).toBe('/sign/5?pr=2147483647');
});

test.each([
  ['zero', 0],
  ['a negative id', -3],
  ['a fraction', 1.5],
  ['NaN', Number.NaN],
  ['infinity', Number.POSITIVE_INFINITY],
  ['a number above the safe range', Number.MAX_SAFE_INTEGER + 1],
])('a repository id of %s is refused', (_what, id) => {
  expect(() => signPath(id, 7)).toThrow(new InvalidSignLinkError('repository id'));
});

test.each([
  ['zero', 0],
  ['a negative number', -1],
  ['a fraction', 7.5],
  ['NaN', Number.NaN],
  ['one above the largest', MAX_PR_NUMBER + 1],
  ['a number above the safe range', Number.MAX_SAFE_INTEGER + 1],
])('a pull request number of %s is refused', (_what, number) => {
  expect(() => signPath(5, number)).toThrow(new InvalidSignLinkError('pull request number'));
});

test('an error names what is wrong and carries none of the values', () => {
  const error = new InvalidSignLinkError('base URL');
  expect(error.name).toBe('InvalidSignLinkError');
  expect(error.message).toBe('Not a valid base URL for a sign link');
});

test.each([
  ['an https origin', 'https://cla.example.org', 'https://cla.example.org/sign/9?pr=3'],
  ['an http origin with a port', http('localhost:3000'), http('localhost:3000/sign/9?pr=3')],
  ['an IPv6 literal', http('[::1]:8080'), http('[::1]:8080/sign/9?pr=3')],
  ['a host with a hyphen and digits', 'https://cla-2.example.org', 'https://cla-2.example.org/sign/9?pr=3'],
])('the address after %s is the origin followed by the path', (_what, origin, address) => {
  expect(signUrl(origin, 9, 3)).toBe(address);
});

test.each([
  ['a trailing slash', 'https://cla.example.org/'],
  ['a path', 'https://cla.example.org/app'],
  ['a query', 'https://cla.example.org?x=1'],
  ['a fragment', 'https://cla.example.org#x'],
  ['credentials', 'https://user:pass@cla.example.org'],
  ['a host in capitals', 'https://CLA.example.org'],
  ['a scheme that is not http', 'ftp://cla.example.org'],
  ['a script', 'javascript:alert(1)'],
  ['a closing bracket that would end the link', 'https://cla.example.org)'],
  ['an angle bracket', 'https://cla.example.org>'],
  ['an underscore in the host', 'https://cla_x.example.org'],
  ['an IPv4 address with five parts, which no URL parser accepts', http('1.2.3.4.5')],
  ['the default port, which the canonical origin leaves out', 'https://cla.example.org:443'],
  ['a space', 'https://cla example.org'],
  ['no scheme', 'cla.example.org'],
  ['nothing', ''],
])('a base URL with %s is refused', (_what, origin) => {
  expect(() => signUrl(origin, 9, 3)).toThrow(new InvalidSignLinkError('base URL'));
});

test('the numbers are checked first, so a bad number is reported whatever the base URL is', () => {
  expect(() => signUrl('not a url', 0, 3)).toThrow(new InvalidSignLinkError('repository id'));
  expect(() => signUrl('not a url', 9, 0)).toThrow(new InvalidSignLinkError('pull request number'));
});
