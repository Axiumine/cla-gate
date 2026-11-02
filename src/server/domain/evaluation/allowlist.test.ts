// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { matchAllowlist } from './allowlist.ts';
import { account, allowlistEntry as entry, membership } from './test-support.ts';
import type { Account, AllowlistEntry } from './types.ts';

// E08-S03: one table for the whole matching rule. Each row names the actor, the allowlist and the known memberships,
// and says which entry id must win (null for no match). Entry ids are distinct inside a row, so the winner is readable.

interface Row {
  readonly name: string;
  readonly actor: Account;
  readonly entries: readonly AllowlistEntry[];
  readonly members?: ReadonlyMap<number, ReadonlySet<number>>;
  readonly expected: number | null;
}

const MAX = Number.MAX_SAFE_INTEGER;
const member500 = membership([500, [10]]);

const kindAndTypeRows: readonly Row[] = [
  {
    name: 'user entry covers a User with the same id',
    actor: account(10),
    entries: [entry(1, 'user', 10)],
    expected: 1,
  },
  {
    name: 'user entry covers an Unknown with the same id',
    actor: account(10, 'Unknown'),
    entries: [entry(1, 'user', 10)],
    expected: 1,
  },
  {
    name: 'user entry covers an Organization with the same id',
    actor: account(10, 'Organization'),
    entries: [entry(1, 'user', 10)],
    expected: 1,
  },
  {
    name: 'user entry covers a Mannequin with the same id',
    actor: account(10, 'Mannequin'),
    entries: [entry(1, 'user', 10)],
    expected: 1,
  },
  {
    name: 'user entry never covers a Bot, even with the same id',
    actor: account(10, 'Bot'),
    entries: [entry(1, 'user', 10)],
    expected: null,
  },
  {
    name: 'user entry for another id covers nobody here',
    actor: account(11),
    entries: [entry(1, 'user', 10)],
    expected: null,
  },
  {
    name: 'bot entry covers a Bot with the same id',
    actor: account(10, 'Bot'),
    entries: [entry(1, 'bot', 10)],
    expected: 1,
  },
  {
    name: 'bot entry covers an Unknown with the same id',
    actor: account(10, 'Unknown'),
    entries: [entry(1, 'bot', 10)],
    expected: 1,
  },
  {
    name: 'bot entry whose id belongs to a User never covers it',
    actor: account(10, 'User'),
    entries: [entry(1, 'bot', 10)],
    expected: null,
  },
  {
    name: 'bot entry never covers an Organization',
    actor: account(10, 'Organization'),
    entries: [entry(1, 'bot', 10)],
    expected: null,
  },
  {
    name: 'bot entry never covers a Mannequin',
    actor: account(10, 'Mannequin'),
    entries: [entry(1, 'bot', 10)],
    expected: null,
  },
  {
    name: 'bot entry for another id covers nobody here',
    actor: account(11, 'Bot'),
    entries: [entry(1, 'bot', 10)],
    expected: null,
  },
];

const membershipRows: readonly Row[] = [
  {
    name: 'org_members covers a User who is a known member',
    actor: account(10),
    entries: [entry(1, 'org_members', 500)],
    members: member500,
    expected: 1,
  },
  {
    name: 'org_members covers an Unknown who is a known member',
    actor: account(10, 'Unknown'),
    entries: [entry(1, 'org_members', 500)],
    members: member500,
    expected: 1,
  },
  {
    name: 'org_members never covers a Bot, even one listed as a member',
    actor: account(10, 'Bot'),
    entries: [entry(1, 'org_members', 500)],
    members: member500,
    expected: null,
  },
  {
    name: 'a Bot listed as a member is covered by neither a user entry nor an org_members entry',
    actor: account(10, 'Bot'),
    entries: [entry(1, 'user', 10), entry(2, 'org_members', 500)],
    members: member500,
    expected: null,
  },
  {
    name: 'org_members never covers an Organization listed as a member',
    actor: account(10, 'Organization'),
    entries: [entry(1, 'org_members', 500)],
    members: member500,
    expected: null,
  },
  {
    name: 'org_members never covers a Mannequin listed as a member',
    actor: account(10, 'Mannequin'),
    entries: [entry(1, 'org_members', 500)],
    members: member500,
    expected: null,
  },
  {
    name: 'a User who is not among the known members of the organisation is not covered',
    actor: account(10),
    entries: [entry(1, 'org_members', 500)],
    members: membership([500, [11, 12]]),
    expected: null,
  },
  {
    name: 'an organisation with no membership fact has no members',
    actor: account(10),
    entries: [entry(1, 'org_members', 500)],
    members: membership(),
    expected: null,
  },
  {
    name: 'an organisation with an empty member set has no members',
    actor: account(10),
    entries: [entry(1, 'org_members', 500)],
    members: membership([500, []]),
    expected: null,
  },
  {
    name: 'being a member of a different organisation does not count',
    actor: account(10),
    entries: [entry(1, 'org_members', 500)],
    members: membership([600, [10]]),
    expected: null,
  },
  {
    name: 'the organisation id of an entry is not a user entry for the account with that id',
    actor: account(500),
    entries: [entry(1, 'org_members', 500)],
    members: membership([500, [11]]),
    expected: null,
  },
  { name: 'an empty allowlist covers nobody', actor: account(10), entries: [], members: member500, expected: null },
  {
    name: 'entries for other people cover nobody',
    actor: account(10),
    entries: [entry(1, 'user', 11), entry(2, 'bot', 12), entry(3, 'org_members', 600)],
    members: member500,
    expected: null,
  },
];

const selectionRows: readonly Row[] = [
  {
    name: 'the same id under user and bot: user wins even with the higher entry id',
    actor: account(10, 'Unknown'),
    entries: [entry(5, 'bot', 10), entry(9, 'user', 10)],
    expected: 9,
  },
  {
    name: 'bot beats org_members',
    actor: account(10, 'Unknown'),
    entries: [entry(1, 'org_members', 500), entry(7, 'bot', 10)],
    members: member500,
    expected: 7,
  },
  {
    name: 'user beats org_members',
    actor: account(10),
    entries: [entry(1, 'org_members', 500), entry(8, 'user', 10)],
    members: member500,
    expected: 8,
  },
  {
    name: 'all three kinds at one scope: user wins',
    actor: account(10, 'Unknown'),
    entries: [entry(1, 'org_members', 500), entry(2, 'bot', 10), entry(3, 'user', 10)],
    members: member500,
    expected: 3,
  },
  {
    name: 'repository scope beats installation scope for the same kind, even with the higher entry id',
    actor: account(10),
    entries: [entry(1, 'user', 10, 'installation'), entry(9, 'user', 10, 'repository')],
    expected: 9,
  },
  {
    name: 'scope comes before kind: a repository org_members entry beats an installation user entry',
    actor: account(10),
    entries: [entry(1, 'user', 10, 'installation'), entry(2, 'org_members', 500, 'repository')],
    members: member500,
    expected: 2,
  },
  {
    name: 'same kind and scope: the lowest entry id wins',
    actor: account(10),
    entries: [entry(9, 'user', 10), entry(3, 'user', 10), entry(5, 'user', 10)],
    expected: 3,
  },
  {
    name: 'the lowest entry id also wins when the entries are listed in ascending order',
    actor: account(10),
    entries: [entry(3, 'user', 10, 'installation'), entry(9, 'user', 10, 'installation')],
    expected: 3,
  },
  {
    name: 'of two org_members entries only the organisation the actor belongs to counts',
    actor: account(10),
    entries: [entry(1, 'org_members', 600), entry(2, 'org_members', 500)],
    members: member500,
    expected: 2,
  },
  {
    name: 'two org_members entries that both hold the actor: the lowest entry id wins',
    actor: account(10),
    entries: [entry(4, 'org_members', 500), entry(2, 'org_members', 600)],
    members: membership([500, [10]], [600, [10]]),
    expected: 2,
  },
  {
    name: 'an entry that does not fit the account type never wins on a lower id',
    actor: account(10),
    entries: [entry(1, 'bot', 10), entry(2, 'user', 10)],
    expected: 2,
  },
];

const edgeRows: readonly Row[] = [
  { name: 'id 1 matches a user entry for id 1', actor: account(1), entries: [entry(1, 'user', 1)], expected: 1 },
  {
    name: 'id 1 does not match a user entry for id 2',
    actor: account(1),
    entries: [entry(1, 'user', 2)],
    expected: null,
  },
  {
    name: 'id 2 does not match a user entry for id 1',
    actor: account(2),
    entries: [entry(1, 'user', 1)],
    expected: null,
  },
  {
    name: 'the largest safe id matches a user entry',
    actor: account(MAX),
    entries: [entry(1, 'user', MAX)],
    expected: 1,
  },
  {
    name: 'the largest safe id does not match its neighbour',
    actor: account(MAX),
    entries: [entry(1, 'user', MAX - 1)],
    expected: null,
  },
  {
    name: 'the largest safe id matches a bot entry',
    actor: account(MAX, 'Bot'),
    entries: [entry(1, 'bot', MAX)],
    expected: 1,
  },
  {
    name: 'the largest safe id works as organisation and as member',
    actor: account(MAX - 1),
    entries: [entry(1, 'org_members', MAX)],
    members: membership([MAX, [MAX - 1]]),
    expected: 1,
  },
  {
    name: 'entry ids at both edges: 1 beats the largest safe id',
    actor: account(10),
    entries: [entry(MAX, 'user', 10), entry(1, 'user', 10)],
    expected: 1,
  },
  {
    name: 'entry ids next to the largest safe id are still ordered',
    actor: account(10),
    entries: [entry(MAX, 'user', 10), entry(MAX - 1, 'user', 10)],
    expected: MAX - 1,
  },
];

const rows: readonly Row[] = [...kindAndTypeRows, ...membershipRows, ...selectionRows, ...edgeRows];

test('the table covers the criterion: at least thirty rows with distinct names', () => {
  expect(rows.length).toBeGreaterThanOrEqual(30);
  expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length);
});

test.each(rows)('$name', ({ actor, entries, members, expected }) => {
  const match = matchAllowlist(actor, entries, members ?? membership());
  expect(match?.id ?? null).toBe(expected);
});
