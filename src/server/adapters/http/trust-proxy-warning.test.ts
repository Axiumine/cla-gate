// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { FakeClock } from '../../services/test-support.ts';
import { testApp } from '../../test-support.ts';

// The warning for a TRUST_PROXY that looks wrong (E10-S08): `trust_proxy_suspected`, at most once a minute, with neither
// the client address nor the header's value in the log.

const T0 = '2026-11-02T10:00:00.000Z';
const PROXIED = { 'x-forwarded-for': '203.0.113.77' };

/** The warnings in a capture's lines. */
function warnings(lines: Record<string, unknown>[]): Record<string, unknown>[] {
  return lines.filter((line) => line['msg'] === 'trust_proxy_suspected');
}

test('a request with X-Forwarded-For while TRUST_PROXY is false logs one trust_proxy_suspected warning', async () => {
  const { app, logs } = await testApp({ clock: new FakeClock(T0) });
  await app.inject({ url: '/healthz', headers: PROXIED });
  expect(warnings(logs.lines())).toEqual([expect.objectContaining({ level: 40, msg: 'trust_proxy_suspected' })]);
});

test('a request with Forwarded alone logs it too', async () => {
  const { app, logs } = await testApp({ env: { TRUST_PROXY: 'false' }, clock: new FakeClock(T0) });
  await app.inject({ url: '/healthz', headers: { forwarded: 'for=198.51.100.9;proto=https' } });
  expect(warnings(logs.lines())).toHaveLength(1);
});

test('a request with neither header logs nothing', async () => {
  const { app, logs } = await testApp({ clock: new FakeClock(T0) });
  await app.inject({ url: '/healthz', headers: { 'x-real-ip': '203.0.113.77', 'user-agent': 'probe' } });
  expect(warnings(logs.lines())).toEqual([]);
});

test('it is logged at most once a minute: the second one comes at exactly 60 seconds, not before', async () => {
  const clock = new FakeClock(T0);
  const { app, logs } = await testApp({ clock });
  for (let sent = 0; sent < 5; sent++) {
    await app.inject({ url: '/healthz', headers: PROXIED });
  }
  expect(warnings(logs.lines())).toHaveLength(1);
  clock.advance(59_999);
  await app.inject({ url: '/healthz', headers: PROXIED });
  expect(warnings(logs.lines())).toHaveLength(1);
  clock.advance(1);
  await app.inject({ url: '/healthz', headers: PROXIED });
  expect(warnings(logs.lines())).toHaveLength(2);
  await app.inject({ url: '/healthz', headers: PROXIED });
  expect(warnings(logs.lines())).toHaveLength(2);
});

test('a request without the header does not use up the minute', async () => {
  const { app, logs } = await testApp({ clock: new FakeClock(T0) });
  await app.inject('/healthz');
  await app.inject({ url: '/healthz', headers: PROXIED });
  expect(warnings(logs.lines())).toHaveLength(1);
});

test('a request that no route answers is looked at too', async () => {
  const { app, logs } = await testApp({ clock: new FakeClock(T0) });
  await app.inject({ url: '/no-such-page', headers: PROXIED });
  expect(warnings(logs.lines())).toHaveLength(1);
});

test('neither the client address nor the header value is logged', async () => {
  const { app, logs } = await testApp({ clock: new FakeClock(T0) });
  await app.inject({
    url: '/healthz',
    remoteAddress: '192.0.2.55',
    headers: { ...PROXIED, forwarded: 'for=198.51.100.9', 'x-request-id': 'trace-1' },
  });
  expect(warnings(logs.lines())).toHaveLength(1);
  expect(logs.text()).not.toMatch(/203\.0\.113\.77|198\.51\.100\.9|192\.0\.2\.55|127\.0\.0\.1/);
});

test.each([
  ['1', '1'],
  ['true', 'true'],
  ['a list of proxies', '127.0.0.1,10.0.0.0/8'],
])('with TRUST_PROXY set (%s) the headers are expected and nothing is logged', async (_label, setting) => {
  const { app, logs } = await testApp({ env: { TRUST_PROXY: setting }, clock: new FakeClock(T0) });
  await app.inject({ url: '/healthz', headers: PROXIED });
  expect(warnings(logs.lines())).toEqual([]);
});
