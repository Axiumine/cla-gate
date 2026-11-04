// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { getRaw, headerValues } from '../../scripts/smoke/http.ts';
import { inspectService } from '../../scripts/smoke/probe.ts';
import { rootCertificate } from '../../scripts/smoke/proxy.ts';
import { clock } from '../../scripts/smoke/system.ts';
import { eventually } from '../../scripts/smoke/wait.ts';
import { ownStack } from './scenario.ts';

// E19-S12, profile `tls`: the reverse proxy with automatic TLS in front of the application, for PUBLIC_BASE_URL=https://localhost.
// Caddy's host ports are random free loopback ports above 32768 (the stack draws them, `ports`), never 80 and 443. `localhost`
// gets its certificate from Caddy's own authority, which needs no DNS and no ACME; the scenario trusts the root certificate it
// copies out of the container and no other.

const stack = ownStack({
  scenario: 'tls',
  profiles: ['tls'],
  ports: ['CADDY_HTTP_PORT', 'CADDY_HTTPS_PORT'],
  settings: { CADDY_BIND_ADDRESS: '127.0.0.1' },
});
const HOST = 'localhost';
const WAIT_MS = 60_000;
const MIN_PORT = 32_769;
let ca = '';

/** The host port a published container port is on, or the empty string. */
async function hostPort(containerPort: string): Promise<string> {
  const { NetworkSettings } = await inspectService(stack(), 'caddy');
  const [binding] = new Map(Object.entries(NetworkSettings.Ports)).get(containerPort) ?? [];
  return binding === undefined ? '' : `${binding.HostIp}:${binding.HostPort}`;
}

function httpsUrl(pathname: string): string {
  return `https://127.0.0.1:${stack().environment['CADDY_HTTPS_PORT']}${pathname}`;
}

test('the proxy is published on loopback ports above 32768 that the stack drew, and not on 80 or 443', async () => {
  const http = stack().environment['CADDY_HTTP_PORT'] ?? '';
  const https = stack().environment['CADDY_HTTPS_PORT'] ?? '';
  expect([http, https, String(stack().port)]).toEqual([...new Set([http, https, String(stack().port)])]);
  expect(Number(http)).toBeGreaterThanOrEqual(MIN_PORT);
  expect(Number(https)).toBeGreaterThanOrEqual(MIN_PORT);
  expect(await hostPort('80/tcp')).toBe(`127.0.0.1:${http}`);
  expect(await hostPort('443/tcp')).toBe(`127.0.0.1:${https}`);
  expect(await hostPort('443/udp')).toBe(`127.0.0.1:${https}`);
});

test("Caddy's root certificate can be copied out of the container", async () => {
  ca = await eventually(clock, "Caddy's root certificate", WAIT_MS, () => rootCertificate(stack()));
  expect(ca).toContain('-----BEGIN CERTIFICATE-----');
});

test('/readyz is 200 over HTTPS when that root certificate is trusted', async () => {
  const reply = await eventually(clock, 'the proxy to answer over HTTPS', WAIT_MS, async () => {
    const answer = await getRaw(httpsUrl('/readyz'), { host: HOST, ca });
    return answer.status === 200 ? answer : undefined;
  });
  expect(JSON.parse(reply.body)).toEqual({ status: 'ready' });
});

test('a client that does not trust that root certificate refuses the connection', async () => {
  await expect(getRaw(httpsUrl('/readyz'), { host: HOST })).rejects.toThrow(/certificate|self.signed/i);
});

test('a plain-HTTP request is redirected to HTTPS', async () => {
  const reply = await getRaw(`http://127.0.0.1:${stack().environment['CADDY_HTTP_PORT']}/readyz`, { host: HOST });
  expect([301, 302, 307, 308]).toContain(reply.status);
  const [location = ''] = headerValues(reply, 'location');
  expect(location.startsWith('https://localhost')).toBe(true);
  expect(location.endsWith('/readyz')).toBe(true);
});

test.each([['/readyz'], ['/']])(
  'GET %s over HTTPS carries exactly one Strict-Transport-Security header',
  async (pathname) => {
    const reply = await getRaw(httpsUrl(pathname), { host: HOST, ca });
    expect(reply.status).toBe(200);
    const values = headerValues(reply, 'strict-transport-security');
    expect(values).toHaveLength(1);
    expect(values[0]).toMatch(/^max-age=\d+/);
  },
);
