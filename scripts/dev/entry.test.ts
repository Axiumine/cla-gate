// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, test, vi } from 'vitest';
import { systemServersDeps } from './lib/dev-children.ts';
import { systemDeps } from './lib/dev-db-cli.ts';
import { systemHookDeps } from './lib/install-hooks.ts';

afterEach(() => {
  process.exitCode = undefined;
  vi.doUnmock('./lib/dev-db-cli.ts');
  vi.doUnmock('./lib/dev-children.ts');
  vi.doUnmock('./lib/dev-servers.ts');
  vi.doUnmock('./lib/install-hooks.ts');
  vi.resetModules();
});

test('db hands its arguments, the repository root, the environment and the real dependencies to the CLI', async () => {
  const runDevDbCli = vi.fn(() => Promise.resolve(3));
  vi.doMock('./lib/dev-db-cli.ts', () => ({ runDevDbCli, systemDeps }));
  const argv = process.argv;
  vi.resetModules();
  process.argv = ['node', 'db.ts', 'url', 'app'];
  await import('./db.ts').finally(() => {
    process.argv = argv;
  });
  const { stdIo } = await import('../ci/lib/io.ts');
  const root = path.resolve(import.meta.dirname, '../..');
  expect(runDevDbCli).toHaveBeenCalledExactlyOnceWith(['url', 'app'], {
    root,
    env: process.env,
    deps: systemDeps,
    io: stdIo,
  });
  expect(process.exitCode).toBe(3);
});

test('install-hooks hands the repository root, the environment and the real dependencies to the installer', async () => {
  const installHooks = vi.fn(() => Promise.resolve(4));
  vi.doMock('./lib/install-hooks.ts', () => ({ installHooks, systemHookDeps }));
  vi.resetModules();
  await import('./install-hooks.ts');
  const { stdIo } = await import('../ci/lib/io.ts');
  const root = path.resolve(import.meta.dirname, '../..');
  expect(installHooks).toHaveBeenCalledExactlyOnceWith(root, process.env, systemHookDeps, stdIo);
  expect(process.exitCode).toBe(4);
});

test('dev hands the repository root, the environment and the real dependencies to the dev servers', async () => {
  const runDevServers = vi.fn(() => Promise.resolve(6));
  vi.doMock('./lib/dev-children.ts', () => ({ systemServersDeps }));
  vi.doMock('./lib/dev-servers.ts', () => ({ runDevServers }));
  vi.resetModules();
  await import('./dev.ts');
  const { stdIo } = await import('../ci/lib/io.ts');
  const root = path.resolve(import.meta.dirname, '../..');
  expect(runDevServers).toHaveBeenCalledExactlyOnceWith({ root, env: process.env, deps: systemServersDeps, io: stdIo });
  expect(process.exitCode).toBe(6);
});
