// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import vm from 'node:vm';
import { build, createServer, type InlineConfig } from 'vite';
import { afterEach, expect, test } from 'vitest';
import { LOOPBACK, pickSystemFreePort } from '../ci/lib/ports.ts';
import { themeAfterRunning } from './test-support.ts';
import { bundleThemeInit, THEME_INIT_FILE, themeInit } from './theme-init-build.ts';

// E17-S05: the bundle of the blocking theme script, and the dev server answering it, from the real vite.config.ts.

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENTRY = path.join(ROOT, 'src/web/theme/theme-init.ts');
const compare = (a: string, b: string): number => a.localeCompare(b);

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

test('the file is theme-init.js, the name index.html loads', () => {
  expect(THEME_INIT_FILE).toBe('theme-init.js');
});

test('the bundle is one classic script: it compiles as a script, and has no import or export left to resolve', async () => {
  const code = await bundleThemeInit();
  // eslint-disable-next-line sonarjs/code-eval -- test: compiling the emitted script as a classic script (not a module) is the check
  expect(() => new vm.Script(code)).not.toThrow();
  expect(code).not.toMatch(/\bimport\b|\bexport\b/);
  expect(code.length).toBeLessThan(1024);
  expect(code.startsWith('(function(){')).toBe(true);
});

test.each([
  ['nothing stored, light system', null, false, 'light'],
  ['nothing stored, dark system', null, true, 'dark'],
  ['light stored, dark system', 'light', true, 'light'],
  ['dark stored, light system', 'dark', false, 'dark'],
  ['system stored, dark system', 'system', true, 'dark'],
  ['a stranger stored, dark system', 'neon', true, 'dark'],
])('the bundled script sets data-theme from what it finds: %s gives %s', async (_page, stored, dark, expected) => {
  expect(themeAfterRunning(await bundleThemeInit(), { stored, dark })).toBe(expected);
});

test('the bundled script survives a storage that throws, and follows the system', async () => {
  expect(themeAfterRunning(await bundleThemeInit(), { stored: 'light', dark: true, throws: true })).toBe('dark');
});

test.each([
  ['no result at all', () => Promise.resolve([])],
  ['a result that is a watcher, with no output', () => Promise.resolve({ close: () => Promise.resolve() })],
])('a build that gives %s fails loudly, so the page is never served without its theme script', async (_what, run) => {
  // @ts-expect-error -- test: a build() stand-in that answers with a value the real one never returns, to reach the guard
  await expect(bundleThemeInit(run)).rejects.toThrow('The build of the theme script produced no output');
});

/** Starts a dev server on a random free loopback port, closes it after the test, and returns its origin. */
async function serve(config: InlineConfig): Promise<string> {
  const port = await pickSystemFreePort();
  const server = await createServer({
    ...config,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    server: { host: LOOPBACK, port, strictPort: true, hmr: false, ws: false },
  });
  closers.push(() => server.close());
  await server.listen();
  return `http://${LOOPBACK}:${port}`;
}

test('the dev server of the real config answers /theme-init.js with the same script the build emits', async () => {
  const origin = await serve({ configFile: path.join(ROOT, 'vite.config.ts') });
  const response = await fetch(`${origin}/theme-init.js`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/javascript');
  expect(response.headers.get('cache-control')).toBe('no-cache');
  const code = await response.text();
  expect(code).toBe(await bundleThemeInit());
  expect(themeAfterRunning(code, { stored: 'dark', dark: false })).toBe('dark');
});

test('the dev server answers /theme-init.js with the bundle, as JavaScript that is never cached', async () => {
  const origin = await serve({ configFile: false, plugins: [themeInit()] });
  const response = await fetch(`${origin}/theme-init.js`);
  expect([response.status, response.headers.get('content-type'), response.headers.get('cache-control')]).toEqual([
    200,
    'text/javascript',
    'no-cache',
  ]);
  expect(await response.text()).toBe(await bundleThemeInit());
});

test('the dev server leaves every other path alone', async () => {
  const origin = await serve({ configFile: false, plugins: [themeInit()] });
  expect((await fetch(`${origin}/theme-init.json`)).status).toBe(404);
});

test('a build with the plugin emits theme-init.js beside the files of the app, without a hash', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [themeInit()],
    build: { write: false, lib: { entry: ENTRY, formats: ['es'], fileName: () => 'entry.js' } },
  });
  const files = [result].flat().flatMap((bundle) => ('output' in bundle ? bundle.output : []));
  const emitted = files.find((file) => file.fileName === THEME_INIT_FILE);
  expect(files.map((file) => file.fileName).sort(compare)).toEqual(['entry.js', 'theme-init.js']);
  expect(emitted?.type).toBe('asset');
  expect(emitted?.type === 'asset' ? emitted.source : undefined).toBe(await bundleThemeInit());
});

test('when the script cannot be built, the dev server answers an error and not an empty script', async () => {
  const failing: typeof build = () => Promise.reject(new Error('the bundler failed'));
  const origin = await serve({ configFile: false, plugins: [themeInit(failing)] });
  const response = await fetch(`${origin}/theme-init.js`);
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('data-theme');
});
