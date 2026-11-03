// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { INDEX_HTML, SCRIPT_TEXT, SCRIPT_URL, webApp } from './spa-fixture/test-support.ts';

// E17-S03: the files of dist/web, served from the API's own origin with the cache rules of the story.

test('the app is served from the same origin: the index at / and at /index.html, a hashed asset with its type', async () => {
  const { app } = await webApp();
  const root = await app.inject('/');
  expect([root.statusCode, root.body]).toEqual([200, INDEX_HTML]);
  expect(root.headers['content-type']).toBe('text/html; charset=utf-8');
  expect((await app.inject('/index.html')).body).toBe(INDEX_HTML);
  const script = await app.inject(SCRIPT_URL);
  expect([script.statusCode, script.body]).toEqual([200, SCRIPT_TEXT]);
  expect(script.headers['content-type']).toBe('application/javascript; charset=utf-8');
  expect((await app.inject('/assets/app-3f9a1c.css')).headers['content-type']).toBe('text/css; charset=utf-8');
});

test.each([
  ['a hashed script', SCRIPT_URL],
  ['a hashed stylesheet', '/assets/app-3f9a1c.css'],
  ['a file in a folder of assets', '/assets/nested/chunk-77aa.js'],
])('%s is cached for a year and never revalidated', async (_what, url) => {
  const { app } = await webApp();
  const response = await app.inject(url);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
});

test.each([
  ['index.html', '/'],
  ['index.html by name', '/index.html'],
  ['robots.txt', '/robots.txt'],
  ['the theme script of the page, which has no hash in its name', '/theme-init.js'],
  ['an icon at the root', '/favicon.svg'],
  ['a file in another folder', '/locales/en.json'],
])('%s is revalidated with an ETag on every use', async (_what, url) => {
  const { app } = await webApp();
  const response = await app.inject(url);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-cache');
  expect(response.headers.etag).toMatch(/^W?\/?"?.+"$/);
});

test('the theme script is served as JavaScript from the root, so the page can load it as a blocking script', async () => {
  const { app } = await webApp();
  const response = await app.inject('/theme-init.js');
  expect(response.headers['content-type']).toBe('application/javascript; charset=utf-8');
  expect(response.body).toContain('data-theme');
});

test('a request that sends the ETag back is answered 304 with no body, and still says no-cache', async () => {
  const { app } = await webApp();
  const first = await app.inject('/');
  const again = await app.inject({ url: '/', headers: { 'if-none-match': String(first.headers.etag) } });
  expect([again.statusCode, again.body]).toEqual([304, '']);
  expect(again.headers['cache-control']).toBe('no-cache');
  const asset = await app.inject(SCRIPT_URL);
  const assetAgain = await app.inject({ url: SCRIPT_URL, headers: { 'if-none-match': String(asset.headers.etag) } });
  expect([assetAgain.statusCode, assetAgain.headers['cache-control']]).toEqual([
    304,
    'public, max-age=31536000, immutable',
  ]);
});

test('HEAD answers the headers of the file and no body', async () => {
  const { app } = await webApp();
  const response = await app.inject({ method: 'HEAD', url: SCRIPT_URL });
  expect([response.statusCode, response.body]).toEqual([200, '']);
  expect(response.headers['content-length']).toBe(String(SCRIPT_TEXT.length));
  expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
});

test.each([
  ['a dotfile', '/.hidden', 'dotfile-marker'],
  ['a file in a dot directory', '/.git/config', 'dotdirectory-marker'],
  ['an encoded dotfile', '/%2ehidden', 'dotfile-marker'],
])(
  '%s is denied: answered as a file that is not there, in the standard error body, even to a browser',
  async (_what, url, marker) => {
    const { app } = await webApp();
    const response = await app.inject({ url, headers: { accept: 'text/html' } });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(marker);
    expect(errorResponseSchema.parse(response.json()).error).toMatchObject({ code: 'not_found', message: 'Not Found' });
  },
);

test.each([['/assets'], ['/assets/'], ['/locales/'], ['/assets/nested']])(
  'a directory (%s) is not listed: no file name appears in the answer',
  async (url) => {
    const { app } = await webApp();
    const response = await app.inject({ url, headers: { accept: '*/*' } });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('app-3f9a1c');
    expect(response.body).not.toContain('chunk-77aa');
    expect(response.body).not.toContain('en.json');
  },
);
