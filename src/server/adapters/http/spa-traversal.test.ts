// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { OUTSIDE_MARKER, webApp } from './spa-fixture/test-support.ts';

// E17-S03: no spelling of a path leaves the web root. `package.json` sits next to it in the fixture, as it does in the
// repository next to dist/.

test('the path of the story, /assets/..%2f..%2fpackage.json, is a 404 in the standard error body', async () => {
  const { app } = await webApp();
  const response = await app.inject('/assets/..%2f..%2fpackage.json');
  expect(response.statusCode).toBe(404);
  expect(response.body).not.toContain(OUTSIDE_MARKER);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({ code: 'not_found', message: 'Not Found' });
});

test.each([
  ['an encoded slash after the dots', '/..%2fpackage.json'],
  ['encoded dots', '/%2e%2e/package.json'],
  ['encoded dots in a folder of assets', '/assets/%2e%2e/%2e%2e/package.json'],
  ['double encoding', '/assets/%252e%252e/%252e%252e/package.json'],
  ['encoded backslashes', '/assets/..%5c..%5cpackage.json'],
  ['a backslash', '/assets/..\\..\\package.json'],
  ['plain dots', '/assets/../../package.json'],
  ['dots after a file', '/assets/app-3f9a1c.js/../../../package.json'],
  ['a doubled slash', '//package.json'],
  ['an absolute-looking path', '/%2fetc/passwd'],
  ['a NUL byte', '/assets/app-3f9a1c.js%00.png'],
])('%s never reaches a file outside the root', async (_what, url) => {
  const { app } = await webApp();
  const response = await app.inject({ url, headers: { accept: '*/*' } });
  expect(response.statusCode).toBeGreaterThanOrEqual(400);
  expect(response.statusCode).toBeLessThan(500);
  expect(response.body).not.toContain(OUTSIDE_MARKER);
  expect(response.headers['content-type']).toMatch(/^application\/json/);
});
