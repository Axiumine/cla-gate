// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SIGN_BLOCKED_REASONS, SIGN_STATES } from '../../shared/sign-context.ts';
import { type Situation, situationOf } from './sign-situation.ts';
import { contextOf, EARLIER_SIGNATURE } from './test-support.ts';

// E18-S02: the state table of the sign page. `state` and `blockedReason` are closed sets and the function that reads them has no
// default branch, so a value added to either fails tsc; these tests pin what each value means today.

const SIGNED = { id: 9, major: 2, minor: 0, signedAt: '2026-11-02T09:30:00.000Z' } as const;
const REVOKED = { major: 1, signedAt: '2026-01-01T00:00:00.000Z', revokedAt: '2026-06-15T12:00:00.000Z' } as const;

const STATE_ROWS = [
  ['ready', {}, { notice: { kind: 'none' }, action: 'form' }],
  ['ready', { revoked: REVOKED }, { notice: { kind: 'revoked', revokedAt: REVOKED.revokedAt }, action: 'form' }],
  [
    'resign_required',
    { signature: EARLIER_SIGNATURE },
    { notice: { kind: 'resign', signature: EARLIER_SIGNATURE }, action: 'form' },
  ],
  ['already_signed', { signature: SIGNED }, { notice: { kind: 'signed', signature: SIGNED }, action: 'none' }],
] as const;

test.each(STATE_ROWS)('the state %s with %j shows %j', (state, overrides, expected) => {
  const shown: Situation = situationOf(contextOf({ state, ...overrides }));
  expect(shown).toEqual(expected);
});

test('the rows above cover every state of the contract, so a state added to it needs a row here', () => {
  const covered = STATE_ROWS.map(([state]) => state);
  expect(new Set(covered)).toEqual(new Set(SIGN_STATES));
});

const REASON_ROWS = [
  ['no_verified_email', false, 'blocked'],
  [null, true, 'form'],
  [null, false, 'cannot'],
] as const;

test.each(REASON_ROWS)('the blocked reason %s with canSign %s is the action %s', (blockedReason, canSign, action) => {
  expect(situationOf(contextOf({ blockedReason, canSign })).action).toBe(action);
});

test('the rows above cover every blocked reason of the contract, so a reason added to it needs a row here', () => {
  const covered = REASON_ROWS.map(([reason]) => reason).filter((reason) => reason !== null);
  expect(new Set(covered)).toEqual(new Set(SIGN_BLOCKED_REASONS));
});

test('a person who already signed has no action, whether or not they could sign', () => {
  const context = contextOf({ state: 'already_signed', signature: SIGNED, canSign: false });
  expect(situationOf(context).action).toBe('none');
});

test('a new major version is announced even when the person cannot sign it yet', () => {
  const context = contextOf({
    state: 'resign_required',
    signature: EARLIER_SIGNATURE,
    emails: [],
    canSign: false,
    blockedReason: 'no_verified_email',
  });
  expect(situationOf(context)).toEqual({
    notice: { kind: 'resign', signature: EARLIER_SIGNATURE },
    action: 'blocked',
  });
});
