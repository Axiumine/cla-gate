// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { missingPermissions } from './permissions.ts';

const ENOUGH = { metadata: 'read', pull_requests: 'write', checks: 'write', issues: 'read', members: 'read' };

test('an installation that grants the minimum is missing nothing', () => {
  expect(missingPermissions(ENOUGH)).toEqual([]);
});

test('a higher level includes the lower ones, and extra permissions are ignored', () => {
  const generous = { ...ENOUGH, pull_requests: 'admin', metadata: 'write', actions: 'read' };
  expect(missingPermissions(generous)).toEqual([]);
});

const without = (name: string): Record<string, string> =>
  Object.fromEntries(Object.entries(ENOUGH).filter(([key]) => key !== name));

test.each(['metadata', 'pull_requests', 'checks', 'issues', 'members'])('a missing %s permission is named', (name) => {
  expect(missingPermissions(without(name))).toEqual([name]);
});

test.each([
  ['pull_requests', 'read'],
  ['checks', 'read'],
])('%s granted only at the level %s is below the minimum of write', (name, level) => {
  expect(missingPermissions({ ...ENOUGH, [name]: level })).toEqual([name]);
});

test('a level this code does not know counts as missing, and nothing granted names all five in order', () => {
  expect(missingPermissions({ ...ENOUGH, issues: 'superuser' })).toEqual(['issues']);
  expect(missingPermissions({})).toEqual(['metadata', 'pull_requests', 'checks', 'issues', 'members']);
});
