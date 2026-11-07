// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { ApprovalRequest } from '../../shared/corporate-approvals.ts';
import { judgeApprovalRequest } from './corporate-approval-request.ts';

// What an approval request must be (E21-S03), judged before anything is looked up: the shape of a login, the form of a domain and the
// free-mail list. The answer says which field is wrong, or that the domain is one anybody can have.

const accepted = (subject: unknown) => ({ ok: true, subject });
const refusedField = (field: string) => ({ ok: false, rule: 'validation_failed', field });

test.each([
  ['a login', { kind: 'user', login: 'ada-lovelace' }, 'ada-lovelace'],
  ['a login with white space around it', { kind: 'user', login: '  Ada  ' }, 'Ada'],
  [
    'the login of a bot, which GitHub then says is no person',
    { kind: 'user', login: 'dependabot[bot]' },
    'dependabot[bot]',
  ],
] as const)('%s is accepted as a user to look up', (_label, request, login) => {
  expect(judgeApprovalRequest(request)).toEqual(accepted({ kind: 'user', login }));
});

test.each([
  ['an empty login', { kind: 'user', login: '' }],
  ['a login of white space', { kind: 'user', login: '   ' }],
  ['a login with a space inside', { kind: 'user', login: 'ada lovelace' }],
  ['a login with a leading hyphen', { kind: 'user', login: '-ada' }],
  ['a login of 40 characters', { kind: 'user', login: 'a'.repeat(40) }],
  ['an address', { kind: 'user', login: 'ada@example.org' }],
  ['a login with an underscore on an organisation', { kind: 'github_org', login: 'acme_org' }],
  ['the login of a bot on an organisation', { kind: 'github_org', login: 'acme[bot]' }],
  ['an empty organisation login', { kind: 'github_org', login: '' }],
] as const)('%s is refused on the field login', (_label, request) => {
  expect(judgeApprovalRequest(request)).toEqual(refusedField('login'));
});

test('an organisation login is accepted as an organisation to look up, trimmed', () => {
  expect(judgeApprovalRequest({ kind: 'github_org', login: ' Acme-Org ' })).toEqual(
    accepted({ kind: 'github_org', login: 'Acme-Org' }),
  );
});

test.each([
  ['a domain in capitals with white space', ' Acme.COM ', 'acme.com'],
  ['an internationalised domain', 'bücher.example', 'xn--bcher-kva.example'],
  ['a name that starts like a company domain', 'acme.com.evil.test', 'acme.com.evil.test'],
  ['a subdomain of a free-mail domain', 'corp.gmail.com', 'corp.gmail.com'],
])('%s is accepted as the domain %s', (_label, typed, domain) => {
  expect(judgeApprovalRequest({ kind: 'email_domain', domain: typed })).toEqual(
    accepted({ kind: 'email_domain', domain }),
  );
});

test.each(['', 'localhost', 'acme.com.', 'https://acme.com', 'ada@acme.com', 'acme.com/x', '192.0.2.1', 'ac​me.com'])(
  'the domain %j is refused on the field domain',
  (domain) => {
    expect(judgeApprovalRequest({ kind: 'email_domain', domain })).toEqual(refusedField('domain'));
  },
);

test.each(['gmail.com', 'GMAIL.COM', ' gmail.com ', 'Proton.me', 'zoho.com', 'googlemail.com'])(
  'the free-mail domain %j is refused as one anybody can have',
  (domain) => {
    const request: ApprovalRequest = { kind: 'email_domain', domain };
    expect(judgeApprovalRequest(request)).toEqual({ ok: false, rule: 'domain_not_allowed' });
  },
);
