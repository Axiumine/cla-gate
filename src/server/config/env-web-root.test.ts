// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { ConfigError, loadConfig } from './env.ts';
import { DEFAULT_WEB_ROOT } from './web-root.ts';

// E17-S03: WEB_ROOT, the directory of the single-page app that the server serves.

const DB = 'postgres://cla_app:pw@db.internal:5432/cla';

test('the default is the web directory next to the server directory: dist/web beside dist/server once built', () => {
  const serverDirectory = path.resolve(import.meta.dirname, '..');
  expect(DEFAULT_WEB_ROOT).toBe(path.join(path.dirname(serverDirectory), 'web'));
  expect(loadConfig({ DATABASE_URL: DB }).webRoot).toBe(DEFAULT_WEB_ROOT);
});

test.each([[undefined], ['']])('WEB_ROOT=%j is unset, so the default applies', (value) => {
  expect(loadConfig({ DATABASE_URL: DB, WEB_ROOT: value }).webRoot).toBe(DEFAULT_WEB_ROOT);
});

test('an absolute WEB_ROOT is kept, and a path with dots in it is cleaned', () => {
  expect(loadConfig({ DATABASE_URL: DB, WEB_ROOT: '/srv/cla/web' }).webRoot).toBe('/srv/cla/web');
  expect(loadConfig({ DATABASE_URL: DB, WEB_ROOT: '/srv/cla/old/../web/' }).webRoot).toBe('/srv/cla/web');
});

test('a relative WEB_ROOT is made absolute against the working directory', () => {
  expect(loadConfig({ DATABASE_URL: DB, WEB_ROOT: 'build/web' }).webRoot).toBe(path.resolve('build/web'));
});

test('a path with a NUL byte names no directory: the variable is refused by name, not by value', () => {
  const attempt = () => loadConfig({ DATABASE_URL: DB, WEB_ROOT: '/srv/cla\0/web' });
  expect(attempt).toThrow(ConfigError);
  expect(attempt).toThrow('WEB_ROOT');
  expect(attempt).not.toThrow('/srv/cla');
});
