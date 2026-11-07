// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  APPROVAL_LIMIT,
  APPROVAL_PAGE_SIZE,
  approvalCreatedSchema,
  approvalCreateRoute,
  approvalListRoute,
  approvalPageQuerySchema,
  approvalPageSchema,
  approvalRequestSchema,
  approvalRevokedSchema,
  approvalRevokeRequestSchema,
  approvalRevokeRoute,
  approvalSchema,
  CORPORATE_APPROVAL_PATH,
  CORPORATE_APPROVALS_PATH,
  CORPORATE_CARRY_OVER_PATH,
  carryOverRequestSchema,
  carryOverResultSchema,
  carryOverRoute,
  GITHUB_ORG_LOGIN_PATTERN,
  REVOKE_REASON_MAX_CODE_POINTS,
} from './corporate-approvals.ts';

// The contract of the approvals of a corporate agreement (E21-S03): the paths, the limits, and the shape of every request and answer.

const APPROVAL = {
  id: 7,
  kind: 'user',
  source: 'manager',
  state: 'active',
  githubId: 4711,
  domain: null,
  login: 'Ada-Lovelace',
  derivedFromApprovalId: null,
  approvedAt: '2026-10-01T10:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  revokeReason: null,
};

test('the paths are the ones the story fixes', () => {
  expect([CORPORATE_APPROVALS_PATH, CORPORATE_APPROVAL_PATH, CORPORATE_CARRY_OVER_PATH]).toEqual([
    '/api/corporate/agreements/:agreementId/approvals',
    '/api/corporate/agreements/:agreementId/approvals/:approvalId',
    '/api/corporate/agreements/:agreementId/approvals/carry-over',
  ]);
});

test('the descriptors name their method and path', () => {
  expect(
    [approvalCreateRoute, approvalListRoute, approvalRevokeRoute, carryOverRoute].map((route) => route.name),
  ).toEqual([
    'POST /api/corporate/agreements/:agreementId/approvals',
    'GET /api/corporate/agreements/:agreementId/approvals',
    'DELETE /api/corporate/agreements/:agreementId/approvals/:approvalId',
    'POST /api/corporate/agreements/:agreementId/approvals/carry-over',
  ]);
});

test('the limits are the ones of the story: 500 in force, pages of 50 up to 200, a reason of 500 characters', () => {
  expect([APPROVAL_LIMIT, APPROVAL_PAGE_SIZE, REVOKE_REASON_MAX_CODE_POINTS]).toEqual([
    500,
    { default: 50, max: 200 },
    500,
  ]);
});

test.each([
  [{ kind: 'user', login: 'ada' }],
  [{ kind: 'github_org', login: 'acme-org' }],
  [{ kind: 'email_domain', domain: 'acme.example' }],
])('the request %j is read as typed, whatever the text says: what the text must be is judged later', (body) => {
  expect(approvalRequestSchema.parse(body)).toEqual(body);
});

test.each([
  ['no kind', { login: 'ada' }],
  ['a kind nobody knows', { kind: 'team', login: 'ada' }],
  ['a user without a login', { kind: 'user' }],
  ['a user with a domain', { kind: 'user', login: 'ada', domain: 'acme.example' }],
  ['a domain with a login', { kind: 'email_domain', domain: 'acme.example', login: 'ada' }],
  ['an organisation without a login', { kind: 'github_org' }],
  ['a login that is not text', { kind: 'user', login: 1 }],
  ['a key the request does not know', { kind: 'user', login: 'ada', note: 'x' }],
  ['no object at all', 'ada'],
])('the request with %s is refused', (_label, body) => {
  expect(approvalRequestSchema.safeParse(body).success).toBe(false);
});

test.each([
  ['nothing', {}, {}],
  ['a limit', { limit: '25' }, { limit: 25 }],
  ['the largest limit', { limit: '200' }, { limit: 200 }],
  ['the smallest limit', { limit: '1' }, { limit: 1 }],
  ['a cursor', { cursor: 'abc' }, { cursor: 'abc' }],
])('the query with %s is read', (_label, query, expected) => {
  expect(approvalPageQuerySchema.parse(query)).toEqual(expected);
});

test.each([
  ['a limit of zero', { limit: '0' }],
  ['a limit over the maximum', { limit: '201' }],
  ['a limit with a leading zero', { limit: '050' }],
  ['a limit with a sign', { limit: '+5' }],
  ['a limit with a fraction', { limit: '1.5' }],
  ['a limit that is empty', { limit: '' }],
  ['a limit of four digits', { limit: '1000' }],
  ['an empty cursor', { cursor: '' }],
  ['a cursor over 1024 characters', { cursor: 'c'.repeat(1025) }],
  ['a key the list does not know', { agreementId: '2' }],
])('the query with %s is refused', (_label, query) => {
  expect(approvalPageQuerySchema.safeParse(query).success).toBe(false);
});

test('the revocation takes no body, or an object with a reason, and nothing else', () => {
  expect(approvalRevokeRequestSchema.parse({})).toEqual({});
  expect(approvalRevokeRequestSchema.parse({ reason: 'left the company' })).toEqual({ reason: 'left the company' });
  expect(approvalRevokeRequestSchema.safeParse({ reason: 1 }).success).toBe(false);
  expect(approvalRevokeRequestSchema.safeParse({ reason: 'x', other: 1 }).success).toBe(false);
});

test('a carry-over names the earlier agreement by a positive whole number, and nothing else', () => {
  expect(carryOverRequestSchema.parse({ fromAgreementId: 3 })).toEqual({ fromAgreementId: 3 });
  for (const body of [
    {},
    { fromAgreementId: 0 },
    { fromAgreementId: -1 },
    { fromAgreementId: 1.5 },
    { fromAgreementId: '3' },
  ]) {
    expect(carryOverRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
  }
  expect(carryOverRequestSchema.safeParse({ fromAgreementId: 3, all: true }).success).toBe(false);
});

test('an approval of each kind and state is an answer, and an answer with a key it does not know or a bad instant is not', () => {
  expect(approvalSchema.parse(APPROVAL)).toEqual(APPROVAL);
  const domain = { ...APPROVAL, kind: 'email_domain', githubId: null, domain: 'acme.example', login: null };
  expect(approvalSchema.parse(domain)).toEqual(domain);
  const revoked = {
    ...APPROVAL,
    state: 'revoked',
    revokedAt: '2026-10-02T10:00:00.000Z',
    revokeReason: 'left',
  };
  expect(approvalSchema.parse(revoked)).toEqual(revoked);
  expect(approvalSchema.safeParse({ ...APPROVAL, extra: 1 }).success).toBe(false);
  expect(approvalSchema.safeParse({ ...APPROVAL, approvedAt: 'yesterday' }).success).toBe(false);
  expect(approvalSchema.safeParse({ ...APPROVAL, approvedAt: '2026-10-01T10:00:00+02:00' }).success).toBe(false);
  expect(approvalSchema.safeParse({ ...APPROVAL, state: 'pending' }).success).toBe(false);
  expect(approvalSchema.safeParse({ ...APPROVAL, id: 0 }).success).toBe(false);
  expect(approvalSchema.safeParse({ ...APPROVAL, githubId: 0 }).success).toBe(false);
});

test('the answers wrap the approval, the page with its cursor, the revocation with its count and the carry-over with its two counts', () => {
  expect(approvalCreatedSchema.parse({ approval: APPROVAL })).toEqual({ approval: APPROVAL });
  expect(approvalPageSchema.parse({ items: [APPROVAL], nextCursor: null })).toEqual({
    items: [APPROVAL],
    nextCursor: null,
  });
  expect(approvalPageSchema.safeParse({ items: [] }).success).toBe(false);
  expect(approvalRevokedSchema.parse({ approval: APPROVAL, derivedRevoked: 0 }).derivedRevoked).toBe(0);
  expect(approvalRevokedSchema.safeParse({ approval: APPROVAL, derivedRevoked: -1 }).success).toBe(false);
  expect(carryOverResultSchema.parse({ copied: 2, skipped: 0 })).toEqual({ copied: 2, skipped: 0 });
  expect(carryOverResultSchema.safeParse({ copied: 2.5, skipped: 0 }).success).toBe(false);
});

test.each(['a', 'Acme-Org', 'a1-b2', `a${'b'.repeat(38)}`])(
  '%s has the shape of the login of an organisation',
  (login) => {
    expect(GITHUB_ORG_LOGIN_PATTERN.test(login)).toBe(true);
  },
);

test.each(['', '-acme', 'acme_org', 'acme[bot]', 'acme org', 'acme.org', `a${'b'.repeat(39)}`, 'acme\n'])(
  '%j has not the shape of the login of an organisation',
  (login) => {
    expect(GITHUB_ORG_LOGIN_PATTERN.test(login)).toBe(false);
  },
);
