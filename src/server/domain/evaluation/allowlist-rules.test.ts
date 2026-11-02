// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { matchAllowlist } from './allowlist.ts';
import { account, allowlistEntry as entry, membership, shuffled } from './test-support.ts';
import { ACCOUNT_TYPES, type Account, type AccountType, ALLOWLIST_KINDS, type AllowlistKind } from './types.ts';

// E08-S03: properties of the matching rule that a row of the table cannot show: the whole kind-by-type matrix, order
// independence, display data that must not matter, and membership that exempts only the member.

const EVERY_KIND_FOR_ONE_ID = [entry(1, 'user', 10), entry(2, 'bot', 10), entry(3, 'org_members', 500)] as const;

// Which account types each kind of entry covers (a member of organisation 500 for org_members). Written out in full so
// that flipping any one cell of the rule fails a row here.
const MATRIX: ReadonlyMap<AllowlistKind, readonly AccountType[]> = new Map([
  ['user', ['User', 'Unknown', 'Organization', 'Mannequin']],
  ['bot', ['Bot', 'Unknown']],
  ['org_members', ['User', 'Unknown']],
]);

const cells = ALLOWLIST_KINDS.flatMap((kind) =>
  ACCOUNT_TYPES.map((type) => ({ kind, type, covered: MATRIX.get(kind)?.includes(type) === true })),
);

test('the matrix has a cell for every kind and every account type', () => {
  expect(cells).toHaveLength(ALLOWLIST_KINDS.length * ACCOUNT_TYPES.length);
  expect(cells.filter((cell) => cell.covered)).toHaveLength(8);
});

test.each(cells)('a $kind entry for the id of a $type account: covered is $covered', ({ kind, type, covered }) => {
  const orgId = 500;
  const githubId = kind === 'org_members' ? orgId : 10;
  const match = matchAllowlist(account(10, type), [entry(1, kind, githubId)], membership([orgId, [10]]));
  expect(match !== null).toBe(covered);
});

test('the match is the very entry that was passed in, not a copy', () => {
  const winner = entry(2, 'bot', 10);
  expect(matchAllowlist(account(10, 'Bot'), [entry(7, 'bot', 11), winner], membership())).toBe(winner);
});

test('the entries and the memberships are left exactly as they were', () => {
  const entries = [entry(3, 'org_members', 500), entry(1, 'bot', 10), entry(2, 'user', 10, 'installation')];
  const before = structuredClone(entries);
  const members = membership([500, [10]]);
  matchAllowlist(account(10, 'Unknown'), entries, members);
  expect(entries).toEqual(before);
  expect(members).toEqual(membership([500, [10]]));
});

test('the order of the entries never changes the winner (100 seeded shuffles)', () => {
  const entries = [
    ...EVERY_KIND_FOR_ONE_ID,
    entry(4, 'user', 10, 'installation'),
    entry(5, 'bot', 10, 'installation'),
    entry(6, 'org_members', 500, 'installation'),
    entry(7, 'user', 99),
    entry(8, 'bot', 10),
  ];
  const members = membership([500, [10]]);
  for (let seed = 1; seed <= 100; seed += 1) {
    expect(matchAllowlist(account(10, 'Unknown'), shuffled(entries, seed), members)?.id).toBe(1);
  }
});

test('with the repository entries removed the installation entries decide, in the same order', () => {
  const installationOnly = [entry(6, 'org_members', 500, 'installation'), entry(5, 'bot', 10, 'installation')];
  const members = membership([500, [10]]);
  expect(matchAllowlist(account(10, 'Unknown'), installationOnly, members)?.id).toBe(5);
  expect(matchAllowlist(account(10, 'Unknown'), installationOnly.slice(0, 1), members)?.id).toBe(6);
});

test.each([undefined, 'dependabot[bot]', 'ordinary-app'])('the app slug %j changes no match', (slug) => {
  const withSlug = (type: AccountType): Account =>
    slug === undefined ? account(10, type) : { id: 10, type, appSlug: slug };
  const entries = [entry(1, 'bot', 10), entry(2, 'user', 10)];
  expect(matchAllowlist(withSlug('User'), entries, membership())?.id).toBe(2);
  expect(matchAllowlist(withSlug('Bot'), entries, membership())?.id).toBe(1);
});

test('a [bot] slug on a User does not let a bot entry cover it, and a plain slug on a Bot does not hide it', () => {
  const botEntry = [entry(1, 'bot', 10)];
  const lookalike: Account = { id: 10, type: 'User', appSlug: 'dependabot[bot]' };
  const plainBot: Account = { id: 10, type: 'Bot', appSlug: 'alice' };
  expect(matchAllowlist(lookalike, botEntry, membership())).toBeNull();
  expect(matchAllowlist(plainBot, botEntry, membership())?.id).toBe(1);
});

test('membership exempts only the member: a non-member co-author of a member commit is judged alone', () => {
  const entries = [entry(1, 'org_members', 500)];
  const members = membership([500, [10]]);
  expect(matchAllowlist(account(10), entries, members)?.id).toBe(1);
  expect(matchAllowlist(account(11, 'Unknown'), entries, members)).toBeNull();
});

test('a failed membership lookup cannot grant coverage: no fact for the org means nobody is a member', () => {
  const entries = [entry(1, 'org_members', 500)];
  expect(matchAllowlist(account(10), entries, membership())).toBeNull();
  expect(matchAllowlist(account(10, 'Unknown'), entries, membership())).toBeNull();
});
