// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { appLinks, isGithubAddress } from './github-links.ts';

// eslint-disable-next-line sonarjs/no-clear-text-protocols -- the address over plain http is the input these tests prove is refused
const PLAIN_HTTP_ADDRESS = 'http://github.com/settings/apps/new';

/** The hostile names that are not made of the characters a slug may have (a run of `n` is a fine slug, if a long one). */
const NOT_SLUGS = HOSTILE_NAMES.filter((name) => !/^[a-z0-9-]+$/u.test(name));

// E19-S07: the addresses on GitHub the setup page puts in a form or a link.

test.each([
  'https://github.com/settings/apps/new?state=abc',
  'https://github.com/organizations/acme/settings/apps/new?state=abc',
  'https://github.com/apps/cla-gate',
  'https://github.com/',
])('%s is an address on GitHub', (address) => {
  expect(isGithubAddress(address)).toBe(true);
});

test.each([
  PLAIN_HTTP_ADDRESS,
  'https://github.com',
  'https://github.com.evil.example/settings/apps/new',
  'https://evil.example/https://github.com/',
  'https://user:pass@github.com/apps/x',
  'https://user@github.com/apps/x',
  'https://:pass@github.com/apps/x',
  'https://github.com@evil.example/apps/x',
  'https://GITHUB.com/apps/x',
  'https://github.com:8443/apps/x',
  'https://gist.github.com/x',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  '//github.com/apps/x',
  '/apps/x',
  '',
  ' https://github.com/apps/x',
  'https://github.com/\u0000',
  'https://github.com/a b',
  'https://github.com/a\tb',
  'https://github.com/a\nb',
  ...HOSTILE_NAMES,
])('%j is not an address on GitHub', (address) => {
  expect(isGithubAddress(address)).toBe(false);
});

test('the install link is built from the slug, never from the install address the server gave', () => {
  const links = appLinks({ slug: 'cla-gate-2', htmlUrl: 'https://github.com/apps/cla-gate-2' });
  expect(links.install).toBe('https://github.com/apps/cla-gate-2/installations/new');
  expect(links.page).toBe('https://github.com/apps/cla-gate-2');
});

test.each(['', 'Cla-Gate', 'cla_gate', 'cla gate', 'cla/gate', '../x', 'a?b', 'a#b', 'é', 'a\n', '\na', ...NOT_SLUGS])(
  'the slug %j gives no install link, and the page link is unaffected',
  (slug) => {
    const links = appLinks({ slug, htmlUrl: 'https://github.com/apps/x' });
    expect(links.install).toBeUndefined();
    expect(links.page).toBe('https://github.com/apps/x');
  },
);

test.each(['javascript:alert(1)', PLAIN_HTTP_ADDRESS, 'https://evil.example/apps/x', '', ...HOSTILE_NAMES])(
  'the address %j gives no page link, and the install link is unaffected',
  (htmlUrl) => {
    const links = appLinks({ slug: 'x', htmlUrl });
    expect(links.page).toBeUndefined();
    expect(links.install).toBe('https://github.com/apps/x/installations/new');
  },
);
