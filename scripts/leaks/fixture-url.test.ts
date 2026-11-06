// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { APP_ORIGIN_VARIABLE, appUrl, fixtureUrl, ORIGIN_VARIABLE } from './fixture-url.ts';

// E20-S07: scenarios ask for a fixture by name; the wrapper tells them the origin, so no scenario holds a port.

afterEach(() => {
  vi.unstubAllEnvs();
});

test('the variable that carries the origin is LEAKS_ORIGIN', () => {
  expect(ORIGIN_VARIABLE).toBe('LEAKS_ORIGIN');
});

test('a fixture url is the origin, a slash and the file name', () => {
  expect(fixtureUrl('clean.html', { LEAKS_ORIGIN: 'http://127.0.0.1:40123' })).toBe(
    'http://127.0.0.1:40123/clean.html',
  );
});

test.each([[{}], [{ LEAKS_ORIGIN: '' }], [{ LEAKS_ORIGIN: undefined }]])(
  'without an origin (%j) the url cannot be built, and the error says how to run a scenario',
  (env) => {
    expect(() => fixtureUrl('clean.html', env)).toThrow(
      'LEAKS_ORIGIN is not set: run the scenarios with tests/leaks/run.ts',
    );
  },
);

test('the environment of the process is used when none is given', () => {
  vi.stubEnv('LEAKS_ORIGIN', 'http://127.0.0.1:41000');
  expect(fixtureUrl('leaky.html')).toBe('http://127.0.0.1:41000/leaky.html');
  vi.stubEnv('LEAKS_ORIGIN', '');
  expect(() => fixtureUrl('leaky.html')).toThrow('LEAKS_ORIGIN is not set');
});

test('the dashboard has an origin of its own (E18-S12): LEAKS_APP_ORIGIN, a slash and the screen', () => {
  expect(APP_ORIGIN_VARIABLE).toBe('LEAKS_APP_ORIGIN');
  const env = { LEAKS_ORIGIN: 'http://127.0.0.1:40123', LEAKS_APP_ORIGIN: 'http://127.0.0.1:40456' };
  expect(appUrl('installations/9001/documents', env)).toBe('http://127.0.0.1:40456/installations/9001/documents');
  expect(fixtureUrl('clean.html', env)).toBe('http://127.0.0.1:40123/clean.html');
});

test.each([[{ LEAKS_ORIGIN: 'http://127.0.0.1:40123' }], [{ LEAKS_APP_ORIGIN: '' }]])(
  'without the origin of the dashboard (%j) a screen has no address, and the error names the variable',
  (env) => {
    expect(() => appUrl('installations', env)).toThrow('LEAKS_APP_ORIGIN is not set');
  },
);

test('the environment of the process is used for the dashboard when none is given', () => {
  vi.stubEnv('LEAKS_APP_ORIGIN', 'http://127.0.0.1:41001');
  expect(appUrl('installations')).toBe('http://127.0.0.1:41001/installations');
});
