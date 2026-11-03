// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import type { UserConfig } from 'vite';
import { afterEach, expect, test, vi } from 'vitest';
import viteConfig from '../../vite.config.ts';
import { LOOPBACK } from '../ci/lib/ports.ts';

// E17-S01: what `yarn build` and the Vite dev server of `yarn dev` do, read from the real vite.config.ts. E17-S03 builds
// the app with this file and inspects the output.

const ROOT = path.resolve(import.meta.dirname, '../..');

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The config for `command`, with PORT set to `port` (or unset). */
function config(command: 'build' | 'serve', port?: string): UserConfig {
  vi.stubEnv('PORT', port);
  return viteConfig({ command, mode: 'test' });
}

/** The proxy table of the dev server, as a map. */
function proxyOf(port: string): ReadonlyMap<string, unknown> {
  return new Map(Object.entries(config('serve', port).server?.proxy ?? {}));
}

test('the build writes dist/web from the app in src/web, and empties it first', () => {
  const { root, build } = config('build');
  expect(root).toBe(path.join(ROOT, 'src/web'));
  expect(build).toMatchObject({ outDir: path.join(ROOT, 'dist/web'), emptyOutDir: true });
});

test('no asset is inlined as a data: URI, which the Content-Security-Policy forbids', () => {
  expect(config('build').build?.assetsInlineLimit).toBe(0);
});

/** The name of every plugin of the config, flattened. */
function pluginNames(): string[] {
  return (config('build').plugins ?? [])
    .flat()
    .map((plugin) => (typeof plugin === 'object' && plugin !== null && 'name' in plugin ? plugin.name : ''));
}

test('the plugins are the React plugin of Vite 8, Tailwind CSS 4 and the theme script of E17-S05, and nothing else', () => {
  const names = pluginNames();
  expect(names).toContain('vite:react-refresh');
  expect(names).toContain('cla:theme-init');
  expect(names.filter((name) => name.startsWith('@tailwindcss/vite:'))).not.toEqual([]);
  expect(names.filter((name) => !/^(?:vite:react|@tailwindcss\/vite:|cla:theme-init$)/.test(name))).toEqual([]);
});

test('no React Compiler plugin is among them: the compiler is off in v0', () => {
  expect(pluginNames().filter((name) => /compiler/i.test(name))).toEqual([]);
});

test('the dev server listens on loopback only and never asks for a well-known port', () => {
  const { server } = config('serve', '45000');
  expect(server?.host).toBe(LOOPBACK);
  expect(server).not.toHaveProperty('port');
});

test('the dev server forwards /api, /healthz and /readyz, and only those, to the app on the port yarn dev picked', () => {
  const proxy = proxyOf('45123');
  expect([...proxy.keys()]).toEqual(['/api', '/healthz', '/readyz']);
  expect([...proxy.values()]).toEqual(Array(3).fill({ target: 'http://127.0.0.1:45123' }));
});

test('the build forwards nothing, whatever PORT is', () => {
  expect(config('build', '45123').server).toEqual({ host: LOOPBACK });
});

test.each([[undefined], ['']])(
  'without a PORT (%j) there is no app to forward to, and the config still loads',
  (port) => {
    expect(config('serve', port).server).toEqual({ host: LOOPBACK, proxy: {} });
  },
);

test.each(['abc', '45000 45001', '-1', '45000.5'])('a PORT that is not a port number (%j) is refused', (port) => {
  expect(() => config('serve', port)).toThrow('PORT must be the port of the Fastify dev server');
});
