// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { installLinkOf } from './install-link.ts';

// E18-S04: what the instance offers for installing the App, made only from an address on GitHub's apps path.

test('an install address under https://github.com/apps/ is a link, as it stands', () => {
  expect(installLinkOf({ installUrl: 'https://github.com/apps/cla-gate/installations/new' })).toEqual({
    kind: 'link',
    href: 'https://github.com/apps/cla-gate/installations/new',
  });
});

test('no install address (the App is not set up) is the setup state', () => {
  expect(installLinkOf({ installUrl: null })).toEqual({ kind: 'setup' });
});

test('no answer yet is unknown, and so is no claim about the setup', () => {
  expect(installLinkOf(undefined)).toEqual({ kind: 'unknown' });
});

test.each([
  'javascript:alert(1)',
  ['http', 'github.com/apps/cla-gate/installations/new'].join('://'),
  'https://evil.example/apps/cla-gate/installations/new',
  'https://github.com.evil.example/apps/cla-gate',
  'https://github.com/settings/apps',
  '//github.com/apps/x',
  '',
])("the address %j is not under GitHub's apps path, so no link is made of it", (installUrl) => {
  expect(installLinkOf({ installUrl })).toEqual({ kind: 'unknown' });
});
