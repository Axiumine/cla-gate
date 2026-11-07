// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { FREE_MAIL_DOMAINS } from '../../../shared/free-mail-domains.ts';
import {
  A_BOT,
  addAs,
  addedOf,
  approvalsUrl,
  approvalWorld,
  changeAs,
  stateOf,
} from './corporate-approval-fixture/test-support.ts';
import { detailsOf, failureOf, withoutRequestId } from './corporate-fixture/test-support.ts';

// What an approval request must be (E21-S03): who may ask, the shape of the body, the form of a login and of a domain (the lookalikes
// of a company's domain among them), the free-mail list, and what GitHub says of a login. A request that fails changes no row.

test('anybody but the signatory gets the 404 of an id that names nothing, byte for byte, with no lookup and no row', async () => {
  const world = await approvalWorld();
  const before = await stateOf(world.db);
  const body = { kind: 'user', login: 'jane-doe' };
  const unknown = await addAs(world, world.ada, 987_654, body);
  const crossed = [
    await addAs(world, world.bob, world.adas.id, body),
    await addAs(world, world.ada, world.bobs.id, body),
  ];
  expect(failureOf(unknown)).toEqual([404, 'not_found']);
  expect(crossed.map(withoutRequestId)).toEqual(crossed.map(() => withoutRequestId(unknown)));
  expect(world.github.calls).toEqual([]);
  expect(await stateOf(world.db)).toEqual(before);
});

test.each([
  ['no body at all', undefined],
  ['a body that is not an object', 'jane-doe'],
  ['an empty object', {}],
  ['a kind nobody knows', { kind: 'team', login: 'jane-doe' }],
  ['a user without a login', { kind: 'user' }],
  ['a login that is not text', { kind: 'user', login: 4711 }],
  ['a domain on a user', { kind: 'user', login: 'jane-doe', domain: 'acme.com' }],
  ['a login on a domain', { kind: 'email_domain', login: 'jane-doe' }],
  ['a key the request does not know', { kind: 'github_org', login: 'acme-org', expiresAt: '2030-01-01T00:00:00Z' }],
])('%s is a 400 bad_request and nothing is looked up or written', async (_label, body) => {
  const world = await approvalWorld();
  const before = await stateOf(world.db);
  const response = await changeAs(world, world.ada, { method: 'POST', url: approvalsUrl(world.adas.id), body });
  expect(failureOf(response)).toEqual([400, 'bad_request']);
  expect(world.github.calls).toEqual([]);
  expect(await stateOf(world.db)).toEqual(before);
});

test.each([
  ['a space inside a login', { kind: 'user', login: 'jane doe' }],
  ['a login with a leading hyphen', { kind: 'user', login: '-jane' }],
  ['a login of 40 characters', { kind: 'user', login: 'j'.repeat(40) }],
  ['an empty login', { kind: 'user', login: '   ' }],
  ['an address instead of a login', { kind: 'user', login: 'jane@acme.com' }],
  ['a path in a login', { kind: 'user', login: 'jane/doe' }],
  ['a login with an underscore on an organisation', { kind: 'github_org', login: 'acme_org' }],
  ['a bot suffix on an organisation', { kind: 'github_org', login: 'acme[bot]' }],
])('%s is a 422 validation_failed on the field login: GitHub is not asked', async (_label, body) => {
  const world = await approvalWorld();
  const response = await addAs(world, world.ada, world.adas.id, body);
  expect(failureOf(response)).toEqual([422, 'validation_failed']);
  expect(detailsOf(response)).toEqual({ field: 'login' });
  expect(world.github.calls).toEqual([]);
});

test.each([
  ['no dot', 'localhost'],
  ['a trailing dot', 'acme.com.'],
  ['an empty label', 'acme..com'],
  ['an IP address', '192.0.2.1'],
  ['an IP address in the shorthand a URL parser expands', '0x7f.1'],
  ['a port', 'acme.com:8080'],
  ['a scheme', 'https://acme.com'],
  ['an address', 'ada@acme.com'],
  ['a wildcard', '*.acme.com'],
  ['a path', 'acme.com/login'],
  ['a space inside', 'ac me.com'],
  ['an invisible character that the Unicode mapping would drop', 'ac\u200bme.com'],
  ['a label of 64 characters', `${'a'.repeat(64)}.com`],
  ['a name of more than 253 characters', `${['a', 'b', 'c', 'd', 'e'].map((c) => c.repeat(60)).join('.')}.com`],
  ['more than a body could hold', `${'a'.repeat(2000)}.com`],
  ['only whitespace', ' \t '],
])('a domain with %s is a 422 validation_failed on the field domain', async (_label, typed) => {
  const world = await approvalWorld();
  const response = await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: typed });
  expect(failureOf(response)).toEqual([422, 'validation_failed']);
  expect(detailsOf(response)).toEqual({ field: 'domain' });
  expect(world.github.calls).toEqual([]);
});

test.each([
  ['whitespace around and capitals', ' Acme.COM \n', 'acme.com'],
  ['an internationalised name, as its punycode form', 'bücher.example', 'xn--bcher-kva.example'],
  ['the same name already in punycode', 'XN--BCHER-KVA.example', 'xn--bcher-kva.example'],
  ['a name that only starts like the company domain', 'acme.com.evil.test', 'acme.com.evil.test'],
  ['a subdomain of a free-mail domain: no implicit parent', 'mail.gmail.com', 'mail.gmail.com'],
  ['a free-mail name followed by more labels', 'gmail.com.evil.test', 'gmail.com.evil.test'],
  ['a name with inner hyphens and digits', 'a-1.b2-c.example', 'a-1.b2-c.example'],
])('a domain with %s is stored as %s (a different domain from the one it resembles)', async (_label, typed, stored) => {
  const world = await approvalWorld();
  const approval = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: typed }));
  expect([approval.kind, approval.domain, approval.githubId, approval.login]).toEqual([
    'email_domain',
    stored,
    null,
    null,
  ]);
});

test('every one of the 16 free-mail domains is refused with 422 domain_not_allowed, in any case and with whitespace', async () => {
  const world = await approvalWorld();
  expect([...FREE_MAIL_DOMAINS]).toHaveLength(16);
  for (const domain of FREE_MAIL_DOMAINS) {
    const response = await addAs(world, world.ada, world.adas.id, {
      kind: 'email_domain',
      domain: ` ${domain.toUpperCase()} `,
    });
    expect(failureOf(response), domain).toEqual([422, 'domain_not_allowed']);
  }
  expect(world.github.calls).toEqual([]);
});

test.each([
  ['a login nobody has', { kind: 'user', login: 'nobody-here' }, 422, 'github_user_not_found'],
  ['the login of a bot', { kind: 'user', login: A_BOT.login }, 422, 'not_a_user'],
  ['the login of an organisation, as a person', { kind: 'user', login: 'acme-org' }, 422, 'not_a_user'],
  ['an organisation nobody has', { kind: 'github_org', login: 'nobody-here' }, 422, 'github_org_not_found'],
  ['the login of a person, as an organisation', { kind: 'github_org', login: 'jane-doe' }, 422, 'github_org_not_found'],
] as const)('%s: %s is a 422 with its own code and no row', async (_label, body, status, code) => {
  const world = await approvalWorld();
  const before = await stateOf(world.db);
  expect(failureOf(await addAs(world, world.ada, world.adas.id, body))).toEqual([status, code]);
  expect(await stateOf(world.db)).toEqual(before);
});
