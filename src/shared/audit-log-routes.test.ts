// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_SUBJECT_TYPE_PATTERN } from './audit-log.ts';
import { auditLogRoute } from './audit-log-routes.ts';
import { pathParamNames } from './contract.ts';

// E18-S09: the descriptor of the audit log API that the audit screen calls by: the method and the path the server registers, the
// success status it answers, the parameters of its path, and the query the screen may send.

test('the audit log is GET /api/installations/:installationId/audit-log, answered with 200', () => {
  expect(auditLogRoute.name).toBe('GET /api/installations/:installationId/audit-log');
  expect(Object.keys(auditLogRoute.responses)).toEqual(['200']);
  expect(pathParamNames(auditLogRoute.path)).toEqual(['installationId']);
});

test.each([
  ['nothing at all', {}, true],
  [
    'every filter at once',
    {
      action: 'signature.revoked',
      actorGithubId: 4711,
      subjectType: 'signature',
      subjectId: 9,
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-02T00:00:00.000Z',
      limit: 50,
      cursor: 'next',
    },
    true,
  ],
  ['an action the catalogue does not know', { action: 'signature.exploded' }, false],
  ['an actor id that is not positive', { actorGithubId: 0 }, false],
  ['an actor that is a login', { actorGithubId: 'octocat' }, false],
  ['a subject id that is not a whole number', { subjectId: 1.5 }, false],
  ['an instant with an offset, which the screen never sends', { from: '2026-11-01T00:00:00+02:00' }, false],
  ['a date that is not an instant', { to: '2026-11-01' }, false],
  ['a limit above 200', { limit: 201 }, false],
  ['a limit of 200', { limit: 200 }, true],
  ['an empty cursor', { cursor: '' }, false],
  ['a cursor of 1025 characters', { cursor: 'c'.repeat(1025) }, false],
  ['a key nobody defined', { q: 'octocat' }, false],
])('the audit query takes %s: %o is valid: %s', (_what, query, valid) => {
  expect(auditLogRoute.query.safeParse(query).success).toBe(valid);
});

test.each([
  ['signature', true],
  ['cla_document', true],
  ['a', true],
  ['a'.repeat(64), true],
  ['a'.repeat(65), false],
  ['Signature', false],
  ['1signature', false],
  ['_signature', false],
  ['signature id', false],
  ["signature'", false],
  ['', false],
])('the subject type %s is one the server accepts: %s', (type, accepted) => {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, with bounded counts and no nested quantifier (linear time); the input is a table of fixed strings
  expect(AUDIT_SUBJECT_TYPE_PATTERN.test(type)).toBe(accepted);
  expect(auditLogRoute.query.safeParse({ subjectType: type }).success).toBe(accepted);
});
