// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
/* eslint-disable sonarjs/no-hardcoded-ip -- the file stores made-up addresses (documentation ranges and a mapped form) and reads them back; none is ever connected to */
import { expect, test } from 'vitest';
import { signedOf, signingWorld } from './sign-fixture/test-support.ts';
import { RECORDING, signFrom, storedNetwork, TEST_AGENT, TEST_IP } from './sign-network-fixture/test-support.ts';

// What the sign request stores when the operator switched `RECORD_NETWORK_METADATA` on (E13-S05): the address Fastify resolved
// from the socket and `TRUST_PROXY`, and the cleaned `User-Agent`, on the erasable `signer_pii` row and nowhere else. The unit
// table of the cleaning is in services/network-metadata.test.ts; these tests send the request through the whole application.

test.each([
  ['an IPv4 address', '203.0.113.7', '203.0.113.7'],
  ['an IPv6 address', '2001:db8::7', '2001:db8::7'],
  ['an IPv4-mapped IPv6 address', '::ffff:203.0.113.9', '::ffff:203.0.113.9'],
])(
  'with recording on, %s of the socket is stored as inet, with the user agent',
  async (_label, remoteAddress, stored) => {
    const state = await signingWorld(RECORDING);
    const response = await signFrom(state, { remoteAddress, headers: { 'user-agent': TEST_AGENT } });
    signedOf(response, 201);
    expect(await storedNetwork(state.world.db)).toEqual([{ ip: stored, userAgent: TEST_AGENT }]);
  },
);

test('the address is the one TRUST_PROXY resolves: a forwarded address behind a trusted proxy, the socket otherwise', async () => {
  const forwarded = { 'x-forwarded-for': '198.51.100.23', 'user-agent': TEST_AGENT };
  const trusting = await signingWorld({ ...RECORDING, TRUST_PROXY: 'true' });
  signedOf(await signFrom(trusting, { remoteAddress: TEST_IP, headers: forwarded }), 201);
  expect(await storedNetwork(trusting.world.db)).toEqual([{ ip: '198.51.100.23', userAgent: TEST_AGENT }]);
  const direct = await signingWorld(RECORDING);
  signedOf(await signFrom(direct, { remoteAddress: TEST_IP, headers: forwarded }), 201);
  expect(await storedNetwork(direct.world.db)).toEqual([{ ip: TEST_IP, userAgent: TEST_AGENT }]);
});

test('text in a forwarded-for header that is no address is not stored, and does not fail the signing', async () => {
  const state = await signingWorld({ ...RECORDING, TRUST_PROXY: 'true' });
  const headers = { 'x-forwarded-for': "zzzz'; drop table signer_pii; --", 'user-agent': TEST_AGENT };
  signedOf(await signFrom(state, { remoteAddress: TEST_IP, headers }), 201);
  expect(await storedNetwork(state.world.db)).toEqual([{ ip: null, userAgent: TEST_AGENT }]);
});

test('a missing User-Agent header stores NULL and the address is still stored', async () => {
  const state = await signingWorld(RECORDING);
  signedOf(await signFrom(state, { remoteAddress: TEST_IP, headers: { 'user-agent': undefined } }), 201);
  expect(await storedNetwork(state.world.db)).toEqual([{ ip: TEST_IP, userAgent: null }]);
});

test('a user agent of 600 characters is stored as its first 512', async () => {
  const state = await signingWorld(RECORDING);
  const long = `${'a1'.repeat(150)}${'b2'.repeat(150)}`;
  signedOf(await signFrom(state, { remoteAddress: TEST_IP, headers: { 'user-agent': long } }), 201);
  const [row] = await storedNetwork(state.world.db);
  expect(long).toHaveLength(600);
  expect(row?.userAgent).toBe(long.slice(0, 512));
  expect(row?.userAgent).toHaveLength(512);
});

test('a user agent of 600 characters outside the Basic Multilingual Plane is stored as 512 characters, which the column accepts', async () => {
  const state = await signingWorld(RECORDING);
  const emoji = '\u{1F600}'.repeat(600);
  signedOf(await signFrom(state, { remoteAddress: TEST_IP, headers: { 'user-agent': emoji } }), 201);
  const [row] = await storedNetwork(state.world.db);
  expect(row?.userAgent).toBe('\u{1F600}'.repeat(512));
});

test.each([
  ['a newline', 'Browser/1.0\nX-Injected: zzzz', 'Browser/1.0X-Injected: zzzz'],
  ['a carriage return and a line feed', 'Browser/1.0\r\nSet-Cookie: zzzz', 'Browser/1.0Set-Cookie: zzzz'],
  ['a NUL byte', 'Brow\u0000ser/1.0', 'Browser/1.0'],
  ['only control characters', '\n\t\r', null],
])('a user agent with %s is stored with the control characters removed', async (_label, header, stored) => {
  const state = await signingWorld(RECORDING);
  signedOf(await signFrom(state, { remoteAddress: TEST_IP, headers: { 'user-agent': header } }), 201);
  expect(await storedNetwork(state.world.db)).toEqual([{ ip: TEST_IP, userAgent: stored }]);
});

test('a signing refused before the insert stores nothing, so no network value outlives a request that did not sign', async () => {
  const state = await signingWorld(RECORDING);
  const refused = await signFrom(
    state,
    { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } },
    { name: '' },
  );
  expect(refused.statusCode).toBe(422);
  expect(await storedNetwork(state.world.db)).toEqual([]);
});
