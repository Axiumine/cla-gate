// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { pickSystemFreePort } from '../ci/lib/ports.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { type AppSite, pathnameOf, serveApp, staticFile } from './app-server.ts';
import type { FixtureServer } from './fixture-server.ts';
import { request } from './test-support.ts';

// E18-S12: the loopback server of the built dashboard in the leak scenarios. Real sockets, random ports, nothing fixed.

const open: FixtureServer[] = [];

afterEach(async () => {
  await Promise.allSettled(open.splice(0).map((server) => server.close()));
});

/** A build directory with the files `yarn build` makes, and a file next to it, outside, that no request may reach. */
function withBuild(): string {
  const base = tempDir();
  makeRepo(base, {
    'build/index.html': '<p>the app</p>',
    'build/favicon.svg': '<svg></svg>',
    'build/theme-init.js': 'window.theme = 1;',
    'build/assets/index-1a2b3c.js': 'export const one = 1;',
    'build/assets/index-1a2b3c.css': 'p { margin: 0; }',
    'build/notes.txt': 'not a built file',
    'outside.html': '<p>outside the build</p>',
  });
  return path.join(base, 'build');
}

async function serving(answers: ReadonlyMap<string, unknown> = new Map()): Promise<FixtureServer> {
  const site: AppSite = { root: withBuild(), answers };
  const server = await serveApp(site, pickSystemFreePort);
  open.push(server);
  return server;
}

test('the origin is http://127.0.0.1 and a port above 32768', async () => {
  const server = await serving();
  expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(Number(new URL(server.origin).port)).toBeGreaterThan(32_768);
});

test.each([
  ['/assets/index-1a2b3c.js', 'export const one = 1;', 'text/javascript; charset=utf-8'],
  ['/assets/index-1a2b3c.css', 'p { margin: 0; }', 'text/css; charset=utf-8'],
  ['/favicon.svg', '<svg></svg>', 'image/svg+xml; charset=utf-8'],
  ['/theme-init.js', 'window.theme = 1;', 'text/javascript; charset=utf-8'],
  ['/index.html', '<p>the app</p>', 'text/html; charset=utf-8'],
])('%s is a built file, served as it is, with its type, not cached and not sniffed', async (rawPath, body, type) => {
  const reply = await request((await serving()).origin, rawPath);
  expect(reply.status).toBe(200);
  expect(reply.body).toBe(body);
  expect(reply.headers['content-type']).toBe(type);
  expect(reply.headers['cache-control']).toBe('no-store');
  expect(reply.headers['x-content-type-options']).toBe('nosniff');
});

test.each([['/'], ['/installations/9001/documents'], ['/installations/9001/documents/9201?tab=history'], ['/zzzz']])(
  '%s is a screen of the app: the page is the index, and the router reads the address',
  async (rawPath) => {
    const reply = await request((await serving()).origin, rawPath);
    expect(reply.status).toBe(200);
    expect(reply.body).toBe('<p>the app</p>');
    expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
  },
);

test('a built file that is not there is a 404 with a plain text body, not the index', async () => {
  const reply = await request((await serving()).origin, '/assets/missing-1.js');
  expect(reply.status).toBe(404);
  expect(reply.body).toBe('not found');
  expect(reply.headers['content-type']).toBe('text/plain; charset=utf-8');
});

test('a path of the table is answered with its body as JSON, whatever the query says', async () => {
  const server = await serving(new Map([['/api/things', { things: [{ id: 1 }] }]]));
  const reply = await request(server.origin, '/api/things?limit=5&cursor=zzzz');
  expect(reply.status).toBe(200);
  expect(JSON.parse(reply.body)).toEqual({ things: [{ id: 1 }] });
  expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
});

test('an API path the table does not know is a 404 in the standard error body, so the app draws its error state', async () => {
  const reply = await request((await serving()).origin, '/api/unknown');
  expect(reply.status).toBe(404);
  expect(JSON.parse(reply.body)).toEqual({
    error: { code: 'not_found', message: 'Not found.', requestId: 'leak-stub' },
  });
});

test.each([['POST'], ['PUT'], ['DELETE'], ['OPTIONS']])(
  '%s is refused with 405, for a screen and for the API',
  async (method) => {
    const server = await serving(new Map([['/api/things', {}]]));
    for (const rawPath of ['/', '/api/things']) {
      const reply = await request(server.origin, rawPath, method);
      expect(reply.status).toBe(405);
      expect(reply.body).toBe('method not allowed');
    }
  },
);

test.each([
  ['/../outside.html'],
  ['/%2e%2e/outside.html'],
  ['/..%2foutside.html'],
  ['/assets/../../outside.html'],
  ['/assets/%2e%2e/%2e%2e/outside.html'],
  ['//etc/passwd'],
  ['/..\\outside.html'],
  ['/notes.txt'],
])('the hostile path %s cannot read a file outside the build or one that is not a built type', async (rawPath) => {
  const reply = await request((await serving()).origin, rawPath);
  expect(reply.body).not.toContain('outside the build');
  expect(reply.body).not.toContain('not a built file');
});

test.each([
  ['/index.html', 'index.html'],
  ['/favicon.svg', 'favicon.svg'],
  ['/assets/index-1a2b3c.js', 'assets/index-1a2b3c.js'],
  ['/assets/a.b-c_d.css', 'assets/a.b-c_d.css'],
])('%s names the built file %s', (pathname, file) => {
  expect(staticFile(pathname)?.file).toBe(file);
});

test.each([
  ['/assets/index-1a2b3c.js', 'text/javascript'],
  ['/assets/index-1a2b3c.css', 'text/css'],
  ['/favicon.svg', 'image/svg+xml'],
  ['/index.html', 'text/html'],
])('%s is served as %s', (pathname, type) => {
  expect(staticFile(pathname)?.type).toBe(type);
});

test('the path of a request is its address without the query, and / when it has none', () => {
  expect(pathnameOf('/installations/9001/documents?tab=history')).toBe('/installations/9001/documents');
  expect(pathnameOf('/api/auth/session')).toBe('/api/auth/session');
  expect(pathnameOf(undefined)).toBe('/');
});

test.each([
  ['/'],
  [''],
  ['//index.html'],
  ['/assets'],
  ['/assets/'],
  ['/other/index-1.js'],
  ['/assets/deep/index-1.js'],
  ['/assets/../index.html'],
  ['/.hidden.js'],
  ['/assets/.hidden.js'],
  ['/..'],
  ['/a b.js'],
  ['/a%2fb.js'],
  ['/a\\b.js'],
  ['/index.html.map'],
  ['/notes.txt'],
  ['/installations/9001/documents'],
])('%j names no built file', (pathname) => {
  expect(staticFile(pathname)).toBeUndefined();
});
