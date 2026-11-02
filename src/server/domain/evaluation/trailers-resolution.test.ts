// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { messageEndingWith, noreplyEmail } from './test-support.ts';
import { noreplyAccountId } from './trailer-identities.ts';
import { parseCoAuthors } from './trailers.ts';

// E08-S06: when a trailer resolves to a numeric id and when it is only advisory. The only form that resolves is
// `ID+login@users.noreply.github.com`; the numeric id is the identity and the login is checked for shape and never used.
// Each row is the VALUE of one trailer (`Name <email>`), the id it resolves to, or null for one `co_author_unresolved`.

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const LOGIN_39 = 'a'.repeat(39);
const LOGIN_40 = 'a'.repeat(40);

const rows: readonly (readonly [name: string, value: string, id: number | null])[] = [
  ['the documented form', `Ada <${noreplyEmail(12, 'ada')}>`, 12],
  ['an id of one digit', `Ada <${noreplyEmail(1, 'ada')}>`, 1],
  ['the largest safe id', `Ada <${noreplyEmail(MAX_SAFE, 'ada')}>`, MAX_SAFE],
  ['an id one above the safe range', `Ada <${noreplyEmail(MAX_SAFE + 1, 'ada')}>`, null],
  ['an id of 20 digits', `Ada <${noreplyEmail('12345678901234567890', 'ada')}>`, null],
  ['an id of 5,000 digits', `Ada <${noreplyEmail('9'.repeat(5000), 'ada')}>`, null],
  ['an id of 0', `Ada <${noreplyEmail(0, 'ada')}>`, null],
  ['an id with a leading zero', `Ada <${noreplyEmail('012', 'ada')}>`, null],
  ['an id of zeros', `Ada <${noreplyEmail('000', 'ada')}>`, null],
  ['a negative id', `Ada <${noreplyEmail(-5, 'ada')}>`, null],
  ['an id with a letter', `Ada <${noreplyEmail('12a', 'ada')}>`, null],
  ['an id with a decimal point', `Ada <${noreplyEmail('1.5', 'ada')}>`, null],
  ['a login of 39 characters', `Ada <${noreplyEmail(12, LOGIN_39)}>`, 12],
  ['a login of 40 characters', `Ada <${noreplyEmail(12, LOGIN_40)}>`, null],
  ['a login of one character', `Ada <${noreplyEmail(12, 'a')}>`, 12],
  ['an empty login', `Ada <${noreplyEmail(12, '')}>`, null],
  ['a login with hyphens, digits and an underscore', `Ada <${noreplyEmail(12, 'Ada-9_acme')}>`, 12],
  ['a login with a dot', `Ada <${noreplyEmail(12, 'a.b')}>`, null],
  ['a login with a second plus', `Ada <${noreplyEmail(12, 'a+b')}>`, null],
  ['the domain in upper case', `Ada <12+ada@USERS.NOREPLY.GITHUB.COM>`, 12],
  ['the domain in mixed case', `Ada <12+ada@Users.NoReply.GitHub.com>`, 12],
  ['the legacy form without an id', 'Ada <ada@users.noreply.github.com>', null],
  ['the legacy form with a numeric login', 'Ada <1234@users.noreply.github.com>', null],
  ['another address', 'Ada <ada@example.org>', null],
  ['an address that only ends like the domain', `Ada <12+ada@evil-users.noreply.github.com>`, null],
  ['an address with the domain as a prefix', `Ada <12+ada@users.noreply.github.com.evil.example>`, null],
  ['an address with a lookalike dotless i', `Ada <12+ada@users.noreply.gıthub.com>`, null],
  ['an address with a space before the closing bracket', `Ada <${noreplyEmail(12)} >`, null],
  ['an address with a space after the opening bracket', `Ada < ${noreplyEmail(12)}>`, null],
  ['no angle brackets', `Ada ${noreplyEmail(12)}`, null],
  ['no closing bracket', `Ada <${noreplyEmail(12)}`, null],
  ['no opening bracket', `Ada ${noreplyEmail(12)}>`, null],
  ['text after the closing bracket', `Ada <${noreplyEmail(12)}> and more`, null],
  ['empty angle brackets', 'Ada <>', null],
  ['an empty name', `<${noreplyEmail(12)}>`, 12],
  ['two bracket groups: the last one is the address', `<${noreplyEmail(5)}> <${noreplyEmail(7)}>`, 7],
  ['an address inside the name does not count', `${noreplyEmail(99, 'victim')} <${noreplyEmail(12)}>`, 12],
  ['an address in the name with no real address', `Ada ${noreplyEmail(99, 'victim')} <nobody>`, null],
];

test.each(rows)('%s', (_name, value, id) => {
  const parsed = parseCoAuthors(messageEndingWith(`Co-authored-by: ${value}`));
  expect(parsed.githubIds).toEqual(id === null ? [] : [id]);
  expect(parsed.advisories).toEqual(id === null ? ['co_author_unresolved'] : []);
});

test.each([
  ['a plain address', 'ada@example.org', null],
  ['an empty string', '', null],
  ['the documented form', '12+ada@users.noreply.github.com', 12],
  ['a match must cover the whole address, not a part of it', 'x12+ada@users.noreply.github.com', null],
  ['a match must cover the whole address at the end too', '12+ada@users.noreply.github.com.x', null],
  ['a newline after the address does not match', '12+ada@users.noreply.github.com\n', null],
] as const)('noreplyAccountId, directly: %s', (_name, email, id) => {
  expect(noreplyAccountId(email)).toBe(id);
});

test('an id is never read from the login: the login may be a number and the id stays the id', () => {
  expect(parseCoAuthors(messageEndingWith(`Co-authored-by: Ada <12+345@users.noreply.github.com>`)).githubIds).toEqual([
    12,
  ]);
});
