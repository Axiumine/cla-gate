// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { signedOf, signingWorld, writtenRows } from './sign-fixture/test-support.ts';
import {
  signFrom,
  storedNetwork,
  TEST_AGENT,
  TEST_IP,
  type Tripwire,
  tripwireApp,
} from './sign-network-fixture/test-support.ts';

// The sign request when the operator has not switched `RECORD_NETWORK_METADATA` on (E13-S05, the default): the address and the
// user agent are not read, not stored, and not logged, and the log line of the request is what it always was.

const WIRES: readonly Tripwire[] = ['ip', 'user-agent'];

test.each(WIRES)(
  'with recording off the handler does not read request %s: a request that throws when it is read is a 201',
  async (wire) => {
    const state = await signingWorld();
    const { sign } = await tripwireApp(state, false, wire);
    const response = await sign();
    expect(response.statusCode).toBe(201);
    expect(await storedNetwork(state.world.db)).toEqual([{ ip: null, userAgent: null }]);
  },
);

test.each(WIRES)(
  'the same double with recording on fails the call, so the double does read what it is meant to: %s',
  async (wire) => {
    const state = await signingWorld();
    const { sign } = await tripwireApp(state, true, wire);
    const response = await sign();
    expect(response.statusCode).toBe(500);
    expect(await writtenRows(state.world.db)).toEqual({ signatures: 0, signerPii: 0, audit: 0 });
  },
);

test('a request with an address and a user agent stores neither column when recording is off', async () => {
  const state = await signingWorld();
  const response = await signFrom(state, { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } });
  signedOf(response, 201);
  expect(await storedNetwork(state.world.db)).toEqual([{ ip: null, userAgent: null }]);
});

test('the log line of the request is the method and the path only, and neither value is anywhere in the log', async () => {
  const state = await signingWorld();
  signedOf(await signFrom(state, { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } }), 201);
  const { logs } = state.world;
  const requests = logs.lines().flatMap((line) => (line['req'] === undefined ? [] : [line['req']]));
  expect(requests).toEqual([{ method: 'POST', url: '/api/sign' }]);
  expect(logs.text()).not.toContain(TEST_IP);
  expect(logs.text()).not.toContain(TEST_AGENT);
});
