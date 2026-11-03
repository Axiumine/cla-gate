// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import Fastify from 'fastify';
import { expect, onTestFinished, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { registerErrorHandlers } from './errors.ts';
import { registerWeb } from './spa.ts';
import { INDEX_HTML, webApp, webFixture } from './spa-fixture/test-support.ts';

// E17-S03: when the server serves the app at all: from WEB_ROOT, except in development, and only a directory that holds a build.

const HTML = { accept: 'text/html' };

test('WEB_ROOT names the directory that is served: nothing of the standard fixture is', async () => {
  const other = webFixture({ 'index.html': '<title>other</title>', 'only-here.txt': 'other' });
  const { app } = await webApp({ WEB_ROOT: other.root });
  expect((await app.inject('/')).body).toBe('<title>other</title>');
  expect((await app.inject('/only-here.txt')).body).toBe('other');
  expect((await app.inject('/robots.txt')).statusCode).toBe(404);
});

test('a relative WEB_ROOT is read against the working directory', async () => {
  const fixture = webFixture();
  const relative = path.relative(process.cwd(), fixture.root);
  expect(path.isAbsolute(relative)).toBe(false);
  const { app } = await webApp({ WEB_ROOT: relative });
  expect((await app.inject('/')).body).toBe(INDEX_HTML);
});

test('with NODE_ENV=development nothing is served even from a complete build, because the Vite dev server does', async () => {
  const { app, logs } = await webApp({ NODE_ENV: 'development' });
  for (const url of ['/', '/index.html', '/signatures', '/robots.txt']) {
    const response = await app.inject({ url, headers: HTML });
    expect(response.statusCode).toBe(404);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
  }
  expect(logs.text()).not.toContain('web.');
});

test.each([
  ['a directory that does not exist', {}],
  ['a directory with no index.html', { 'robots.txt': 'x' }],
])('%s is not served, and the log says so', async (_what, files) => {
  const fixture = webFixture(files);
  const { app, logs } = await webApp({ WEB_ROOT: fixture.root });
  const missing = await app.inject({ url: '/robots.txt', headers: HTML });
  expect(missing.statusCode).toBe(404);
  expect(errorResponseSchema.parse(missing.json()).error.code).toBe('not_found');
  expect((await app.inject({ url: '/', headers: HTML })).statusCode).toBe(404);
  expect(logs.lines().filter((line) => line['msg'] === 'web.not_served')).toEqual([
    expect.objectContaining({ level: 40, webRoot: fixture.root }),
  ]);
});

test('a path that is not there at all is not served and is logged the same way', async () => {
  const fixture = webFixture();
  const absent = path.join(fixture.parent, 'absent');
  const { logs } = await webApp({ WEB_ROOT: absent });
  expect(logs.lines().filter((line) => line['msg'] === 'web.not_served')).toHaveLength(1);
});

test('an index.html that is a directory is not a build', async () => {
  const fixture = webFixture({ 'index.html/inner.txt': 'x' });
  const { app, logs } = await webApp({ WEB_ROOT: fixture.root });
  expect((await app.inject({ url: '/', headers: HTML })).statusCode).toBe(404);
  expect(logs.text()).toContain('web.not_served');
});

test('serving is logged once at start-up, with the directory and no more', async () => {
  const { logs, fixture } = await webApp();
  expect(logs.lines().filter((line) => line['msg'] === 'web.serving')).toEqual([
    expect.objectContaining({ level: 30, webRoot: fixture.root }),
  ]);
});

test.each(['test', 'production'] as const)(
  'NODE_ENV=%s serves the app, on any Fastify instance that is given the config',
  async (nodeEnv) => {
    const fixture = webFixture();
    const app = Fastify();
    registerErrorHandlers(app);
    onTestFinished(() => app.close());
    await registerWeb(app, { nodeEnv, webRoot: fixture.root });
    expect((await app.inject({ url: '/signatures', headers: HTML })).body).toBe(INDEX_HTML);
  },
);
