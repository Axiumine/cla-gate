// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { OPERATOR_INSTALLATIONS_PATH, operatorInstallationsRoute } from './operator.ts';

// E18-S13: the descriptor of the operator API that the operator screen calls by: the method and the path the server registers, the success
// status it answers, and the shape of an installation (ids, snapshots, states, times and counts, nothing personal).

const ROW = {
  githubInstallationId: 100001,
  accountId: 4000,
  accountLogin: 'acme',
  accountType: 'Organization',
  admissionStatus: 'admitted',
  admissionReason: null,
  admissionDecidedAt: '2026-10-01T09:00:00.000Z',
  suspendedAt: null,
  deletedAt: null,
  tenantState: 'active',
  repositories: { active: 12, enabled: 3, removed: 1 },
};

const parse = (row: object) => operatorInstallationsRoute.responses[200].safeParse({ installations: [row] });

test('the operator list is GET /api/operator/installations, answered with 200', () => {
  expect(operatorInstallationsRoute.name).toBe('GET /api/operator/installations');
  expect(operatorInstallationsRoute.path).toBe(OPERATOR_INSTALLATIONS_PATH);
  expect(Object.keys(operatorInstallationsRoute.responses)).toEqual(['200']);
});

test('a row the endpoint sends is valid, and an empty list is too', () => {
  expect(parse(ROW).success).toBe(true);
  expect(operatorInstallationsRoute.responses[200].safeParse({ installations: [] }).success).toBe(true);
});

test.each([
  ['a tenant state nobody defined', { tenantState: 'gone' }],
  ['an admission status nobody defined', { admissionStatus: 'maybe' }],
  ['an admission reason nobody defined', { admissionReason: 'because' }],
  ['an account type nobody defined', { accountType: 'Bot' }],
  ['an installation id that is not positive', { githubInstallationId: 0 }],
  ['a time with an offset', { suspendedAt: '2026-10-01T09:00:00+02:00' }],
  ['a negative count', { repositories: { active: -1, enabled: 0, removed: 0 } }],
  ['a missing count', { repositories: { active: 1, enabled: 0 } }],
])('a row with %s is not valid', (_what, change) => {
  expect(parse({ ...ROW, ...change }).success).toBe(false);
});
