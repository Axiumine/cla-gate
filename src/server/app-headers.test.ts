// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { PUBLIC_ROUTE, testApp } from './test-support.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('every response carries the strict security headers, errors and 404s included', async () => {
  const { app } = await testApp();
  for (const url of ['/healthz', '/readyz', '/missing']) {
    const { headers } = await app.inject(url);
    expect(headers['content-security-policy']).toBe(
      "default-src 'self';script-src 'self';style-src 'self';base-uri 'self';form-action 'self';frame-ancestors 'none';object-src 'none'",
    );
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['x-powered-by']).toBeUndefined();
    expect(headers['strict-transport-security']).toBeUndefined();
  }
});

test('the policy allows no inline script and no framing', async () => {
  const { app } = await testApp();
  const policy = String((await app.inject('/healthz')).headers['content-security-policy']);
  expect(policy).not.toContain('unsafe-inline');
  expect(policy).not.toContain('unsafe-eval');
  expect(policy).not.toContain('*');
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("form-action 'self'");
});

test('behind an https public URL the app also sends HSTS and upgrades insecure requests', async () => {
  const { app } = await testApp({ env: { PUBLIC_BASE_URL: 'https://cla.example.org' } });
  const { headers } = await app.inject('/healthz');
  expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
  expect(headers['content-security-policy']).toContain('upgrade-insecure-requests');
});

test('a request id is minted when the caller sends none, and echoed in the header', async () => {
  const { app } = await testApp();
  const first = await app.inject('/healthz');
  const second = await app.inject('/healthz');
  expect(first.headers['x-request-id']).toMatch(UUID);
  expect(second.headers['x-request-id']).not.toBe(first.headers['x-request-id']);
});

test('a well formed caller request id is kept and appears in the logs', async () => {
  const { app, logs } = await testApp();
  const response = await app.inject({ url: '/healthz', headers: { 'x-request-id': 'trace-abc-123' } });
  expect(response.headers['x-request-id']).toBe('trace-abc-123');
  expect(logs.lines().every((line) => line['reqId'] === 'trace-abc-123')).toBe(true);
  expect(logs.lines().length).toBeGreaterThan(0);
});

test('a malformed caller request id is replaced, so it cannot forge log fields', async () => {
  const { app, logs } = await testApp();
  const forged = 'x","level":60,"msg":"pwned';
  const response = await app.inject({ url: '/healthz', headers: { 'x-request-id': forged } });
  expect(response.headers['x-request-id']).toMatch(UUID);
  expect(logs.text()).not.toContain('pwned');
});

test.each([
  ['no proxy is trusted by default', {}, '10.1.2.3, 203.0.113.9', '127.0.0.1'],
  [
    'TRUST_PROXY=true trusts every hop and takes the left-most address',
    { TRUST_PROXY: 'true' },
    '198.51.100.1, 203.0.113.9',
    '198.51.100.1',
  ],
  [
    'TRUST_PROXY=1 trusts one hop and takes the address that hop saw',
    { TRUST_PROXY: '1' },
    '198.51.100.1, 203.0.113.9',
    '203.0.113.9',
  ],
  ['TRUST_PROXY=0 trusts nobody', { TRUST_PROXY: '0' }, '198.51.100.1', '127.0.0.1'],
  [
    'a trusted address list takes the address the proxy saw',
    { TRUST_PROXY: '127.0.0.1' },
    '198.51.100.1, 203.0.113.9',
    '203.0.113.9',
  ],
  [
    'an address list that does not contain the peer trusts nothing',
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- test input for the trust list parser, never connected to
    { TRUST_PROXY: '10.0.0.0/8' },
    '198.51.100.1',
    '127.0.0.1',
  ],
])('client address: %s', async (_label, env, forwardedFor, expected) => {
  const { app } = await testApp({ env });
  app.get('/ip', PUBLIC_ROUTE, (request) => ({ ip: request.ip }));
  const response = await app.inject({ url: '/ip', headers: { 'x-forwarded-for': forwardedFor } });
  expect(response.json()).toEqual({ ip: expected });
});
