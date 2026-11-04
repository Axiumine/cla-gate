// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { RATE_LIMITS } from '../adapters/http/rate-limit.ts';
import { testApp } from '../test-support.ts';

// The check that docs/operations/reverse-proxy.md tells the operator to run after every change of the proxy or of
// TRUST_PROXY (E19-S09): `x-ratelimit-remaining` on /healthz goes down by one for each request of one client address, starts
// again from the budget for another address, and follows the address the setting believes. The addresses are the ranges that
// documentation reserves, and the "proxy" is a connection from the stack's subnet.

// eslint-disable-next-line sonarjs/no-hardcoded-ip -- the private range of the stack, written as data
const STACK = '172.30.30.0/24';
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- an address inside the range above: the proxy of the stack
const PROXY = '172.30.30.1';
const CLIENT = '203.0.113.7';
const OTHER_CLIENT = '203.0.113.9';
const INVENTED = '198.51.100.20';
const INVENTED_TOO = '198.51.100.21';

type Env = Readonly<Record<string, string>>;

/** The numbers `x-ratelimit-remaining` shows for one request after another, each from the connection and headers given. */
async function remaining(env: Env, requests: readonly { from: string; forwarded?: string }[]): Promise<number[]> {
  const { app } = await testApp({ env });
  const counts: number[] = [];
  for (const request of requests) {
    const response = await app.inject({
      url: '/healthz',
      remoteAddress: request.from,
      ...(request.forwarded === undefined ? {} : { headers: { 'x-forwarded-for': request.forwarded } }),
    });
    counts.push(Number(response.headers['x-ratelimit-remaining']));
  }
  return counts;
}

const FIRST = RATE_LIMITS.global - 1;

test('step 1: one client, three requests: the number goes down by one each time', async () => {
  expect(await remaining({ TRUST_PROXY: 'false' }, [{ from: CLIENT }, { from: CLIENT }, { from: CLIENT }])).toEqual([
    FIRST,
    FIRST - 1,
    FIRST - 2,
  ]);
});

test('step 2: a second client starts from the budget again, so two clients do not share one', async () => {
  expect(
    await remaining({ TRUST_PROXY: 'false' }, [{ from: CLIENT }, { from: CLIENT }, { from: OTHER_CLIENT }]),
  ).toEqual([FIRST, FIRST - 1, FIRST]);
});

test('step 2 fails, and says the setting is too narrow, when the proxy is not trusted: every client is the proxy', async () => {
  const through = (client: string) => ({ from: PROXY, forwarded: client });
  expect(await remaining({ TRUST_PROXY: 'false' }, [through(CLIENT), through(CLIENT), through(OTHER_CLIENT)])).toEqual([
    FIRST,
    FIRST - 1,
    FIRST - 2,
  ]);
});

test('step 2 passes behind a proxy that the setting names: each client behind it has a budget of its own', async () => {
  const through = (client: string) => ({ from: PROXY, forwarded: client });
  expect(await remaining({ TRUST_PROXY: STACK }, [through(CLIENT), through(CLIENT), through(OTHER_CLIENT)])).toEqual([
    FIRST,
    FIRST - 1,
    FIRST,
  ]);
});

test('step 3: a proxy that overwrites the header makes two invented addresses one client, so the second number is lower', async () => {
  const overwritten = { from: PROXY, forwarded: CLIENT };
  expect(await remaining({ TRUST_PROXY: STACK }, [overwritten, overwritten])).toEqual([FIRST, FIRST - 1]);
});

test('step 3 passes without a proxy too: a connection the setting does not trust cannot choose its address', async () => {
  const [first, second] = await remaining({ TRUST_PROXY: STACK }, [
    { from: CLIENT, forwarded: INVENTED },
    { from: CLIENT, forwarded: INVENTED_TOO },
  ]);
  expect([first, second]).toEqual([FIRST, FIRST - 1]);
});

test('step 3 fails, and says the setting is too wide, when every hop is believed: the client chooses its own address', async () => {
  const [first, second] = await remaining({ TRUST_PROXY: 'true' }, [
    { from: CLIENT, forwarded: INVENTED },
    { from: CLIENT, forwarded: INVENTED_TOO },
  ]);
  expect([first, second]).toEqual([FIRST, FIRST]);
});

test('step 4: trust_proxy_suspected is logged while the setting is false and a forwarded header arrives, and not when the proxy is trusted', async () => {
  const narrow = await testApp({ env: { TRUST_PROXY: 'false' } });
  await narrow.app.inject({ url: '/healthz', remoteAddress: PROXY, headers: { 'x-forwarded-for': CLIENT } });
  expect(narrow.logs.text()).toContain('trust_proxy_suspected');
  const named = await testApp({ env: { TRUST_PROXY: STACK } });
  await named.app.inject({ url: '/healthz', remoteAddress: PROXY, headers: { 'x-forwarded-for': CLIENT } });
  expect(named.logs.text()).not.toContain('trust_proxy_suspected');
});
