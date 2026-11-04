// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import http from 'node:http';
import https from 'node:https';
import { afterEach, expect, test } from 'vitest';
import { getRaw, headerValues, TRANSPORTS } from './http.ts';

// E19-S12: the raw GET of the TLS scenario, against a real server on a random loopback port. The TLS handshake itself is
// Node's and is exercised by the scenario against Caddy; here the options that ask for it are read.

const servers: http.Server[] = [];

/** Stops a server and the connections it still holds. */
function stop(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => {
      resolve();
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(stop));
});

/** A server on a free loopback port that answers every request with `handler`; returns its address and what the requests said. */
async function serve(
  handler: http.RequestListener,
): Promise<{ readonly url: string; readonly hosts: string[]; readonly server: http.Server }> {
  const hosts: string[] = [];
  const server = http.createServer((request, response) => {
    hosts.push(request.headers.host ?? '');
    handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the server has no TCP address');
  }
  return { url: `http://127.0.0.1:${address.port}`, hosts, server };
}

test('getRaw returns the status, every header line as sent (a repeated header twice) and the body, with the Host header asked for', async () => {
  const { url, hosts } = await serve((_request, response) => {
    response.writeHead(200, [
      ['Strict-Transport-Security', 'max-age=1'],
      ['strict-transport-security', 'max-age=2'],
      ['Content-Type', 'text/plain'],
    ]);
    response.end('hello');
  });
  const reply = await getRaw(`${url}/path`, { host: 'localhost' });
  expect(reply.status).toBe(200);
  expect(reply.body).toBe('hello');
  expect(headerValues(reply, 'STRICT-TRANSPORT-SECURITY')).toEqual(['max-age=1', 'max-age=2']);
  expect(headerValues(reply, 'x-missing')).toEqual([]);
  expect(hosts).toEqual(['localhost']);
});

test('a redirect is an answer, not something to follow', async () => {
  const { url } = await serve((_request, response) => {
    response.writeHead(308, { location: 'https://localhost/readyz' });
    response.end();
  });
  const reply = await getRaw(`${url}/readyz`, { host: 'localhost' });
  expect([reply.status, headerValues(reply, 'location')]).toEqual([308, ['https://localhost/readyz']]);
});

test('a server that does not answer in time is an error naming the address and the time', async () => {
  const { url } = await serve(() => undefined);
  await expect(getRaw(url, { host: 'localhost', timeoutMs: 50 })).rejects.toThrow(`no answer from ${url} within 50 ms`);
});

test('a connection that is refused is an error', async () => {
  const { url, server } = await serve((_request, response) => {
    response.end();
  });
  await stop(server);
  await expect(getRaw(url, { host: 'localhost' })).rejects.toThrow(/ECONNREFUSED/);
});

test('an address that is https asks for the server name of the host and trusts the given authority, and http asks for neither', async () => {
  const { url } = await serve((_request, response) => {
    response.end('ok');
  });
  const seen: Record<string, unknown>[] = [];
  const transports: typeof TRANSPORTS = {
    http: (target, options, callback) => {
      seen.push({ protocol: 'http', ...options });
      return TRANSPORTS.http(target, options, callback);
    },
    https: (target, options, callback) => {
      seen.push({ protocol: 'https', ...options });
      return TRANSPORTS.http(new URL(`http://${target.host}${target.pathname}`), options, callback);
    },
  };
  const secure = await getRaw(url.replace('http:', 'https:'), { host: 'localhost', ca: 'PEM TEXT' }, transports);
  const withoutAuthority = await getRaw(url.replace('http:', 'https:'), { host: 'localhost' }, transports);
  const plain = await getRaw(url, { host: 'localhost', ca: 'PEM TEXT' }, transports);
  expect([secure.body, withoutAuthority.body, plain.body]).toEqual(['ok', 'ok', 'ok']);
  expect(seen[0]).toMatchObject({ protocol: 'https', servername: 'localhost', ca: 'PEM TEXT', method: 'GET' });
  expect(seen[1]).toMatchObject({ protocol: 'https', servername: 'localhost' });
  expect(seen[1]).not.toHaveProperty('ca');
  expect(seen[2]).toMatchObject({ protocol: 'http' });
  expect(seen[2]).not.toHaveProperty('servername');
  expect(seen[2]).not.toHaveProperty('ca');
});

test('the default transports are the ones of node:http and node:https', () => {
  expect(TRANSPORTS.http).toBe(http.request);
  expect(TRANSPORTS.https).toBe(https.request);
});
