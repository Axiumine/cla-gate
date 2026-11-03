// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { readCallbackParams } from './callback-params.ts';

// E19-S07: the `code` and `state` GitHub puts in the address of /setup/callback.

const STATE = 'A'.repeat(43);
const CODE = 'a180b1a3d263c81bc6441d7b990bae27d4c10679';

test.each([
  [`?code=${CODE}&state=${STATE}`, { code: CODE, state: STATE }],
  [`code=${CODE}&state=${STATE}`, { code: CODE, state: STATE }],
  [`?state=${STATE}&code=${CODE}`, { code: CODE, state: STATE }],
  [`?code=${CODE}&state=${STATE}&extra=1`, { code: CODE, state: STATE }],
  // A code made of digits only is a JSON number to the router, and would not survive it; the raw query keeps it exact.
  [`?code=12345678901234567890&state=${STATE}`, { code: '12345678901234567890', state: STATE }],
  [`?code=0123&state=${STATE}`, { code: '0123', state: STATE }],
])('%s is the code and the state it holds', (search, expected) => {
  expect(readCallbackParams(search)).toEqual(expected);
});

test.each([
  ['an empty query', ''],
  ['only a question mark', '?'],
  ['no code', `?state=${STATE}`],
  ['no state', `?code=${CODE}`],
  ['an empty code', `?code=&state=${STATE}`],
  ['an empty state', `?code=${CODE}&state=`],
  ['two codes', `?code=${CODE}&code=${CODE}&state=${STATE}`],
  ['two states', `?code=${CODE}&state=${STATE}&state=${STATE}`],
  ['a code with a slash', `?code=ab%2Fcd&state=${STATE}`],
  ['a code with a dot dot', `?code=..&state=${STATE}`],
  ['a code with markup', `?code=${encodeURIComponent('<script>alert(1)</script>')}&state=${STATE}`],
  ['a code of 65 characters', `?code=${'a'.repeat(65)}&state=${STATE}`],
  ['a state of 42 characters', `?code=${CODE}&state=${'A'.repeat(42)}`],
  ['a state of 44 characters', `?code=${CODE}&state=${'A'.repeat(44)}`],
  ['a state with a plus', `?code=${CODE}&state=${'A'.repeat(42)}%2B`],
  ['the names in another case', `?CODE=${CODE}&STATE=${STATE}`],
  ['an error from GitHub instead', '?error=access_denied&error_description=nope'],
])('%s is not a return from GitHub', (_what, search) => {
  expect(readCallbackParams(search)).toBeUndefined();
});
