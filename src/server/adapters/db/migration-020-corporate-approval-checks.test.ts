// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  type CorporateTenant,
  corporateTenant,
  daysFromNow,
  insertApprovalRow,
  validUserRow,
} from './corporate-fixture/test-support.ts';
import { containing, migratedTestDatabase, seedTenant } from './test-support.ts';

// Migration 020 (E21-S01), the CHECK constraints of corporate_approvals: what each kind holds, what a manager approval and a rule
// approval need, and the shape of a revocation. Every case spoils exactly one thing of a valid row, so the constraint named is the
// one that refuses it.

const CHECK = { code: '23514' };
const SIGNATORY = 501;
const NEW_PERSON = 6001;

/** One tenant with the agreement of a signatory, a domain approval to derive from, and nothing else to collide with. */
async function world() {
  const { db } = await migratedTestDatabase();
  const corporate = await corporateTenant(db, await seedTenant(db, 1), SIGNATORY);
  return { db, corporate };
}

/** A domain row (no numeric id) to start from. */
const domainRow = (corporate: CorporateTenant, domain: string): Record<string, unknown> => ({
  ...validUserRow(corporate, NEW_PERSON),
  kind: 'email_domain',
  subject_github_id: null,
  subject_domain: domain,
});

/** A rule row (derived from the domain approval, valid for a year) to start from. */
const ruleRow = (corporate: CorporateTenant): Record<string, unknown> => ({
  ...validUserRow(corporate, NEW_PERSON),
  source: 'rule',
  approved_by: null,
  derived_from_approval_id: corporate.domainApproval,
  expires_at: daysFromNow(365),
});

/** A revoked manager row to start from; the revocation is dated in the future so that it follows the approval. */
const revokedRow = (corporate: CorporateTenant): Record<string, unknown> => ({
  ...validUserRow(corporate, NEW_PERSON),
  revoked_at: daysFromNow(1),
  revoked_by: corporate.signed.person.userId,
});

/** A domain of exactly `length` characters made of valid labels, to try the limit of 253. */
function domainOfLength(length: number): string {
  const fixed = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.`;
  return `${fixed}${'d'.repeat(length - fixed.length - '.com'.length)}.com`;
}

const SUBJECT = 'corporate_approvals_subject_check';

test.each([
  [
    'a user approval without a numeric id',
    SUBJECT,
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), subject_github_id: null }),
  ],
  [
    'a user approval that also names a domain',
    SUBJECT,
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), subject_domain: 'acme.example' }),
  ],
  [
    'an org approval without a numeric id',
    SUBJECT,
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), kind: 'github_org', subject_github_id: null }),
  ],
  [
    'an org approval that also names a domain',
    SUBJECT,
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), kind: 'github_org', subject_domain: 'acme.example' }),
  ],
  [
    'a domain approval without a domain',
    SUBJECT,
    (c: CorporateTenant) => ({ ...domainRow(c, 'x.example'), subject_domain: null }),
  ],
  [
    'a domain approval that also names an id',
    SUBJECT,
    (c: CorporateTenant) => ({ ...domainRow(c, 'x.example'), subject_github_id: 5 }),
  ],
  ['a numeric id of zero', 'corporate_approvals_subject_github_id_check', (c: CorporateTenant) => validUserRow(c, 0)],
  ['a negative numeric id', 'corporate_approvals_subject_github_id_check', (c: CorporateTenant) => validUserRow(c, -4)],
  [
    'a kind that does not exist',
    'corporate_approvals_kind_check',
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), kind: 'team' }),
  ],
  [
    'a source that does not exist',
    'corporate_approvals_source_check',
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), source: 'delegate', approved_by: null }),
  ],
] as const)('the schema refuses %s', async (_case, constraint, row) => {
  const { db, corporate } = await world();
  await expect(insertApprovalRow(db, row(corporate))).rejects.toMatchObject({
    ...CHECK,
    message: containing(constraint),
  });
});

test.each([
  ['upper case', 'Acme.example'],
  ['a trailing space', 'acme.example '],
  ['a leading space', ' acme.example'],
  ['no dot', 'acme'],
  ['a trailing dot', 'acme.example.'],
  ['an empty label', 'acme..example'],
  ['a leading dot', '.acme.example'],
  ['a label that starts with a hyphen', '-acme.example'],
  ['a label that ends with a hyphen', 'acme-.example'],
  ['an IPv4 address', '203.0.113.7'],
  ['a top-level label of digits', 'acme.123'],
  ['an underscore', 'ac_me.example'],
  ['a letter outside ASCII, which is its punycode form', 'bücher.example'],
  ['an address with an at sign', '@acme.example'],
  ['a mail address', 'dev@acme.example'],
  ['a path', 'acme.example/path'],
  ['a wildcard', '*.acme.example'],
  ['a label of 64 characters', `${'a'.repeat(64)}.example`],
  ['254 characters', domainOfLength(254)],
  ['the empty string', ''],
])('a domain approval refuses a domain with %s', async (_case, domain) => {
  const { db, corporate } = await world();
  await expect(insertApprovalRow(db, domainRow(corporate, domain))).rejects.toMatchObject({
    ...CHECK,
    message: containing('corporate_approvals_subject_domain_check'),
  });
});

test.each([
  ['a plain domain', 'plain.example'],
  ['a subdomain', 'mail.eu.acme.example'],
  ['digits and hyphens inside a label', '3m-labs.example'],
  ['the punycode form of an internationalised name', 'xn--bcher-kva.example'],
  ['a label of 63 characters', `${'a'.repeat(63)}.example`],
  ['253 characters', domainOfLength(253)],
])('a domain approval takes %s', async (_case, domain) => {
  const { db, corporate } = await world();
  expect(await insertApprovalRow(db, domainRow(corporate, domain))).toBeGreaterThan(0);
});

test('the long domains of these cases are 253 and 254 characters, and every label of them is a valid one', () => {
  expect([domainOfLength(253).length, domainOfLength(254).length]).toEqual([253, 254]);
  expect(
    domainOfLength(254)
      .split('.')
      .every((label) => label.length <= 63),
  ).toBe(true);
});

test.each([
  [
    'a rule approval of a domain',
    'corporate_approvals_rule_user_check',
    (c: CorporateTenant) => ({
      ...ruleRow(c),
      kind: 'email_domain',
      subject_github_id: null,
      subject_domain: 'sub.acme.example',
    }),
  ],
  [
    'a rule approval of an org',
    'corporate_approvals_rule_user_check',
    (c: CorporateTenant) => ({ ...ruleRow(c), kind: 'github_org' }),
  ],
  [
    'a manager approval without the manager',
    'corporate_approvals_approved_by_check',
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), approved_by: null }),
  ],
  [
    'a rule approval that names a manager',
    'corporate_approvals_approved_by_check',
    (c: CorporateTenant) => ({ ...ruleRow(c), approved_by: c.signed.person.userId }),
  ],
  [
    'a rule approval that derives from nothing',
    'corporate_approvals_derived_from_check',
    (c: CorporateTenant) => ({ ...ruleRow(c), derived_from_approval_id: null }),
  ],
  [
    'a manager approval that derives from another',
    'corporate_approvals_derived_from_check',
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), derived_from_approval_id: c.domainApproval }),
  ],
  [
    'a rule approval that never expires',
    'corporate_approvals_expires_at_check',
    (c: CorporateTenant) => ({ ...ruleRow(c), expires_at: null }),
  ],
  [
    'a manager approval that expires',
    'corporate_approvals_expires_at_check',
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), expires_at: daysFromNow(30) }),
  ],
  [
    'a rule approval that expired before it was made',
    'corporate_approvals_expiry_order_check',
    (c: CorporateTenant) => ({ ...ruleRow(c), expires_at: daysFromNow(-1) }),
  ],
] as const)('the schema refuses %s', async (_case, constraint, row) => {
  const { db, corporate } = await world();
  await expect(insertApprovalRow(db, row(corporate))).rejects.toMatchObject({
    ...CHECK,
    message: containing(constraint),
  });
});

test.each([
  [
    'a revocation time without the person who revoked',
    'corporate_approvals_revocation_pair_check',
    (c: CorporateTenant) => ({ ...revokedRow(c), revoked_by: null }),
  ],
  [
    'a person who revoked without the time',
    'corporate_approvals_revocation_pair_check',
    (c: CorporateTenant) => ({ ...revokedRow(c), revoked_at: null }),
  ],
  [
    'a reason without a revocation',
    'corporate_approvals_revoke_reason_needs_revocation_check',
    (c: CorporateTenant) => ({ ...validUserRow(c, 1), revoke_reason: 'left the company' }),
  ],
  [
    'a revocation before the approval',
    'corporate_approvals_revocation_order_check',
    (c: CorporateTenant) => ({ ...revokedRow(c), revoked_at: daysFromNow(-1) }),
  ],
  [
    'a reason of 501 characters',
    'corporate_approvals_revoke_reason_check',
    (c: CorporateTenant) => ({ ...revokedRow(c), revoke_reason: 'r'.repeat(501) }),
  ],
] as const)('the schema refuses %s', async (_case, constraint, row) => {
  const { db, corporate } = await world();
  await expect(insertApprovalRow(db, row(corporate))).rejects.toMatchObject({
    ...CHECK,
    message: containing(constraint),
  });
});

test('a reason of 500 characters, a manager approval and a rule approval of a user are stored', async () => {
  const { db, corporate } = await world();
  await insertApprovalRow(db, { ...revokedRow(corporate), revoke_reason: 'r'.repeat(500) });
  await insertApprovalRow(db, { ...ruleRow(corporate), subject_github_id: NEW_PERSON + 1 });
  const rows = await db
    .selectFrom('corporate_approvals')
    .select(['source', 'kind'])
    .where('subject_github_id', 'in', [NEW_PERSON, NEW_PERSON + 1])
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    { source: 'manager', kind: 'user' },
    { source: 'rule', kind: 'user' },
  ]);
});
