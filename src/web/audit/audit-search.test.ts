// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { auditSearchSchema } from './audit-search.ts';

// E18-S09: the address of the audit screen holds the filters and the cursor; whatever is not one of them is dropped instead of
// failing the page.

test('an address with every value keeps them, the moments in their canonical text', () => {
  expect(
    auditSearchSchema.parse({
      action: 'signature.revoked',
      actorGithubId: 4711,
      subjectType: 'signature',
      subjectId: 9,
      from: '2026-11-01',
      to: '2026-11-02T09:30:00Z',
      cursor: 'c2',
    }),
  ).toEqual({
    action: 'signature.revoked',
    actorGithubId: 4711,
    subjectType: 'signature',
    subjectId: 9,
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-02T09:30:00.000Z',
    cursor: 'c2',
  });
});

test('an address with nothing is the whole log', () => {
  expect(auditSearchSchema.parse({})).toEqual({});
});

test.each([
  ['an action nobody has', { action: 'signature.exploded' }, 'action'],
  ['an action in capitals', { action: 'SIGNATURE.REVOKED' }, 'action'],
  ['a list for an action', { action: ['signature.revoked'] }, 'action'],
  ['an actor of zero', { actorGithubId: 0 }, 'actorGithubId'],
  ['an actor that is a login', { actorGithubId: 'octocat' }, 'actorGithubId'],
  ['an actor with a decimal', { actorGithubId: 1.5 }, 'actorGithubId'],
  ['an actor beyond a safe integer', { actorGithubId: 1e21 }, 'actorGithubId'],
  ['a negative subject id', { subjectId: -4 }, 'subjectId'],
  ['a subject type in capitals', { subjectType: 'Signature' }, 'subjectType'],
  ['a subject type with a space', { subjectType: 'signature id' }, 'subjectType'],
  ['a subject type of 65 characters', { subjectType: `a${'b'.repeat(64)}` }, 'subjectType'],
  ['a start with an offset', { from: '2026-11-01T09:30:00+02:00' }, 'from'],
  ['a start that is not a date', { from: 'yesterday' }, 'from'],
  ['an end that is a number', { to: 4 }, 'to'],
  ['an empty cursor', { cursor: '' }, 'cursor'],
  ['a cursor of 1025 characters', { cursor: 'a'.repeat(1025) }, 'cursor'],
  ['a cursor that is a list', { cursor: ['a'] }, 'cursor'],
])('%s is dropped', (_what, input, key) => {
  expect(auditSearchSchema.parse(input)).toEqual({ [key]: undefined });
});

test('a range that ends before it starts keeps its start and drops its end, as the form would not accept it', () => {
  expect(auditSearchSchema.parse({ from: '2026-11-02', to: '2026-11-01', action: 'signature.created' })).toEqual({
    action: 'signature.created',
    from: '2026-11-02T00:00:00.000Z',
    to: undefined,
  });
});

test('a range of one moment is kept: it is empty and not backwards', () => {
  expect(auditSearchSchema.parse({ from: '2026-11-01', to: '2026-11-01' })).toEqual({
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z',
  });
});

test.each([
  ['an installation, which the address already holds', { installationId: 6 }],
  ['a login', { actor: 'octocat' }],
  ['a limit', { limit: 200 }],
])('a key nobody defined, %s, is not part of the result', (_what, input) => {
  expect(Object.keys(auditSearchSchema.parse(input))).not.toContain(Object.keys(input)[0]);
});
