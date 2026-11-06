// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { PORT_MAX, PORT_MIN, pickSystemFreePort } from '../ci/lib/ports.ts';
import { readText } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { type FixtureServer, fixtureName, serveFixtures } from './fixture-server.ts';
import { FIXTURES_DIR } from './paths.ts';
import { request } from './test-support.ts';

// E20-S07: the loopback server for the pages the scenarios load. Real sockets, random ports, nothing fixed.

const open: FixtureServer[] = [];

afterEach(async () => {
  await Promise.allSettled(open.splice(0).map((server) => server.close()));
});

async function serving(root: string, pick: () => Promise<number> = pickSystemFreePort): Promise<FixtureServer> {
  const server = await serveFixtures(root, pick);
  open.push(server);
  return server;
}

/** A fixtures directory with one page and one non-page, and a page next to it, outside, that no request may reach. */
function withPages(): string {
  const base = tempDir();
  makeRepo(base, {
    'pages/page-one.html': '<p>one</p>',
    'pages/secret.txt': 'not a page',
    'outside.html': '<p>outside the fixtures</p>',
  });
  return path.join(base, 'pages');
}

test('the origin is http://127.0.0.1 and the port the caller picked, which is in the repository range above 32768', async () => {
  const port = await pickSystemFreePort();
  const server = await serving(withPages(), () => Promise.resolve(port));
  expect(server.origin).toBe(`http://127.0.0.1:${port}`);
  expect(port).toBeGreaterThan(32_768);
  expect(port).toBeGreaterThanOrEqual(PORT_MIN);
  expect(port).toBeLessThanOrEqual(PORT_MAX);
});

test('a fixture is served as HTML that must not be cached or sniffed', async () => {
  const server = await serving(withPages());
  const reply = await request(server.origin, '/page-one.html');
  expect(reply.status).toBe(200);
  expect(reply.body).toBe('<p>one</p>');
  expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(reply.headers['cache-control']).toBe('no-store');
  expect(reply.headers['x-content-type-options']).toBe('nosniff');
});

test('a query string does not change which fixture is served', async () => {
  const server = await serving(withPages());
  expect((await request(server.origin, '/page-one.html?x=1&y=2')).body).toBe('<p>one</p>');
  expect((await request(server.origin, '/page-one.html')).body).toBe('<p>one</p>');
});

test('the real fixtures are served byte for byte', async () => {
  const server = await serving(FIXTURES_DIR);
  const clean = await request(server.origin, '/clean.html');
  const leaky = await request(server.origin, '/leaky.html');
  expect(clean.body).toBe(readText(path.join(FIXTURES_DIR, 'clean.html')));
  expect(leaky.body).toBe(readText(path.join(FIXTURES_DIR, 'leaky.html')));
  expect(leaky.body).toContain('window.retainedRows.push(row)');
  expect(clean.body).not.toContain('retainedRows');
});

test.each([
  ['/missing.html'],
  ['/'],
  ['/secret.txt'],
  ['/page-one.html/'],
  ['/page-one'],
  ['/Page-One.html'],
  ['/favicon.ico'],
])('%s is a 404 with a plain text body', async (rawPath) => {
  const server = await serving(withPages());
  const reply = await request(server.origin, rawPath);
  expect(reply.status).toBe(404);
  expect(reply.body).toBe('not found');
  expect(reply.headers['content-type']).toBe('text/plain; charset=utf-8');
});

test.each([
  ['/../outside.html'],
  ['/%2e%2e/outside.html'],
  ['/..%2foutside.html'],
  ['/%2e%2e%2foutside.html'],
  ['/page-one.html/../../outside.html'],
  ['//etc/passwd'],
  ['/..\\outside.html'],
  ['/page-one.html%00.png'],
])('the hostile path %s cannot read a file outside the fixtures', async (rawPath) => {
  const server = await serving(withPages());
  const reply = await request(server.origin, rawPath);
  expect(reply.body).not.toContain('outside the fixtures');
  expect(reply.status === 404 || reply.status === 400).toBe(true);
});

test.each([['POST'], ['PUT'], ['DELETE'], ['OPTIONS']])(
  '%s is refused with 405, even for a page that exists',
  async (method) => {
    const server = await serving(withPages());
    const reply = await request(server.origin, '/page-one.html', method);
    expect(reply.status).toBe(405);
    expect(reply.body).toBe('method not allowed');
  },
);

test('the names that are fixtures are flat lower-case html files, and the rest is undefined', () => {
  expect(fixtureName('/clean.html')).toBe('clean.html');
  expect(fixtureName('/page-2.html?x=1')).toBe('page-2.html');
  expect(fixtureName(undefined)).toBeUndefined();
  expect(fixtureName('/a/b.html')).toBeUndefined();
  expect(fixtureName('/.html')).toBeUndefined();
  expect(fixtureName('/1page.html')).toBeUndefined();
  expect(fixtureName('/page.HTML')).toBeUndefined();
  expect(fixtureName('/page.html.txt')).toBeUndefined();
  expect(fixtureName('/..%2fpage.html')).toBeUndefined();
});

test('the server listens on the loopback interface only', async () => {
  const server = await serving(withPages());
  const { port } = new URL(server.origin);
  const external = Object.values(os.networkInterfaces())
    .flat()
    .find((each) => each?.family === 'IPv4' && !each.internal)?.address;
  const attempt = (host: string) =>
    new Promise<string>((resolve) => {
      const socket = net.connect({ host, port: Number(port) }, () => {
        socket.destroy();
        resolve('connected');
      });
      socket.on('error', (error: NodeJS.ErrnoException) => {
        resolve(error.code ?? 'error');
      });
    });
  expect(await attempt('127.0.0.1')).toBe('connected');
  // A machine without a non-loopback IPv4 address has nothing to try: the loopback check above still holds.
  expect(external === undefined ? 'ECONNREFUSED' : await attempt(external)).toBe('ECONNREFUSED');
});

test('closing frees the port, even with a connection still open', async () => {
  const server = await serving(withPages());
  const { port } = new URL(server.origin);
  const idle = net.connect({ host: '127.0.0.1', port: Number(port) });
  await new Promise((resolve) => idle.once('connect', resolve));
  await server.close();
  idle.destroy();
  const refused = await new Promise<string>((resolve) => {
    net.connect({ host: '127.0.0.1', port: Number(port) }).on('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code ?? 'error');
    });
  });
  expect(refused).toBe('ECONNREFUSED');
});

test('closing a server that is already closed fails instead of pretending', async () => {
  const server = await serving(withPages());
  await server.close();
  await expect(server.close()).rejects.toThrow(/not running/i);
});

test('a port that is already taken makes the start fail', async () => {
  const first = await serving(withPages());
  const taken = Number(new URL(first.origin).port);
  await expect(serveFixtures(withPages(), () => Promise.resolve(taken))).rejects.toThrow(/EADDRINUSE/);
});
