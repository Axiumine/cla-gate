// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { signStatus, type ViewerSignature } from './sign-state.ts';

// E13-S02: where a person stands on the version in force. Pure, so every branch and every tie is shown here with plain values.

const DAY_MS = 86_400_000;

/** The instant of day `day`, in milliseconds. */
const at = (day: number): number => day * DAY_MS;

/** What a test says of a signature: its id, version numbers and the days it was signed and revoked. */
interface Spec {
  readonly id: number;
  readonly major: number;
  readonly minor: number;
  readonly signed: number;
  readonly revoked?: number;
}

/** A signature of the viewer: not revoked unless the spec names a day. */
function signature(spec: Spec): ViewerSignature {
  return {
    id: spec.id,
    major: spec.major,
    minor: spec.minor,
    signedAtMs: at(spec.signed),
    revokedAtMs: spec.revoked === undefined ? null : at(spec.revoked),
  };
}

test('with no signature at all the person is ready to sign, with nothing to show', () => {
  expect(signStatus(1, [])).toEqual({ state: 'ready', signature: null, revoked: null });
});

test('a signature of exactly the active major covers the person and is the one named, whatever its minor', () => {
  const lower = signature({ id: 3, major: 2, minor: 0, signed: 1 });
  const higher = signature({ id: 3, major: 2, minor: 7, signed: 1 });
  expect(signStatus(2, [lower])).toEqual({ state: 'already_signed', signature: lower, revoked: null });
  expect(signStatus(2, [higher])).toEqual({ state: 'already_signed', signature: higher, revoked: null });
});

test('a signature of a lower major asks for a new one: resign_required names that signature', () => {
  const old = signature({ id: 4, major: 1, minor: 3, signed: 1 });
  expect(signStatus(2, [old])).toEqual({ state: 'resign_required', signature: old, revoked: null });
});

test('of several lower majors the latest is named, and of equal ones the lowest id, whatever the order given', () => {
  const first = signature({ id: 1, major: 1, minor: 0, signed: 1 });
  const second = signature({ id: 2, major: 2, minor: 0, signed: 2 });
  const twin = signature({ id: 9, major: 2, minor: 0, signed: 3 });
  expect(signStatus(5, [first, twin, second]).signature).toBe(second);
  expect(signStatus(5, [twin, second, first]).signature).toBe(second);
  expect(signStatus(5, [first, second, twin]).signature).toBe(second);
});

test('a signature of the active major wins over an older one, and of equal ones the lowest id is named', () => {
  const older = signature({ id: 1, major: 1, minor: 0, signed: 1 });
  const current = signature({ id: 5, major: 2, minor: 0, signed: 2 });
  const twin = signature({ id: 3, major: 2, minor: 1, signed: 3 });
  expect(signStatus(2, [older, current])).toEqual({ state: 'already_signed', signature: current, revoked: null });
  expect(signStatus(2, [current, twin]).signature).toBe(twin);
  expect(signStatus(2, [twin, current]).signature).toBe(twin);
});

test('a signature of a higher major than the active one covers nobody: it is no more valid than a lower one', () => {
  expect(signStatus(2, [signature({ id: 1, major: 3, minor: 0, signed: 1 })])).toEqual({
    state: 'ready',
    signature: null,
    revoked: null,
  });
  const old = signature({ id: 2, major: 1, minor: 0, signed: 1 });
  expect(signStatus(2, [signature({ id: 3, major: 3, minor: 0, signed: 2 }), old])).toEqual({
    state: 'resign_required',
    signature: old,
    revoked: null,
  });
});

test('a revoked signature covers nobody, whatever its major: the person is ready and the revoked signature is named', () => {
  const sameMajor = signature({ id: 1, major: 2, minor: 0, signed: 1, revoked: 2 });
  const lowerMajor = signature({ id: 2, major: 1, minor: 0, signed: 3, revoked: 4 });
  expect(signStatus(2, [sameMajor])).toEqual({ state: 'ready', signature: null, revoked: sameMajor });
  expect(signStatus(2, [lowerMajor])).toEqual({ state: 'ready', signature: null, revoked: lowerMajor });
});

test('the revoked signature carries the instant of its revocation', () => {
  const revoked = signature({ id: 1, major: 2, minor: 0, signed: 1, revoked: 6 });
  expect(signStatus(2, [revoked]).revoked?.revokedAtMs).toBe(at(6));
});

test('of several revoked signatures the one signed last is named, the highest id among equals, whatever the order given', () => {
  const early = signature({ id: 7, major: 1, minor: 0, signed: 1, revoked: 9 });
  const late = signature({ id: 2, major: 2, minor: 0, signed: 5, revoked: 6 });
  const sameInstant = signature({ id: 3, major: 3, minor: 0, signed: 5, revoked: 7 });
  expect(signStatus(4, [early, late]).revoked).toBe(late);
  expect(signStatus(4, [late, early]).revoked).toBe(late);
  expect(signStatus(4, [late, sameInstant, early]).revoked).toBe(sameInstant);
  expect(signStatus(4, [sameInstant, early, late]).revoked).toBe(sameInstant);
});

test('a live signature outranks every revoked one, and then nothing revoked is shown', () => {
  const live = signature({ id: 5, major: 2, minor: 0, signed: 1 });
  const revoked = signature({ id: 6, major: 1, minor: 0, signed: 2, revoked: 3 });
  expect(signStatus(2, [revoked, live])).toEqual({ state: 'already_signed', signature: live, revoked: null });
  const outdated = signature({ id: 7, major: 1, minor: 0, signed: 1 });
  expect(signStatus(3, [revoked, outdated])).toEqual({ state: 'resign_required', signature: outdated, revoked: null });
});

test('the signatures are not changed or reordered by the call', () => {
  const list = [
    signature({ id: 2, major: 1, minor: 0, signed: 2 }),
    signature({ id: 1, major: 1, minor: 0, signed: 1 }),
  ];
  const copy = [...list];
  signStatus(2, list);
  expect(list).toEqual(copy);
});
