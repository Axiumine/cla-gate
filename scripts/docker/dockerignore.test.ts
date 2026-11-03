// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { ROOT } from './test-support.ts';

// E19-S01: what the build context leaves out. The entries are asserted one by one, so removing one fails by name.

const entries = readText(path.join(ROOT, '.dockerignore'))
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

test.each([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'reports',
  '.vitest',
  '.stryker-tmp',
  'e2e',
  'playwright-report',
  'test-results',
  '.env*',
  'secrets/',
  '*.pem',
  '*.tsbuildinfo',
])('.dockerignore excludes %s', (entry) => {
  expect(entries).toContain(entry);
});

test('.dockerignore lets the example environment file back in, after the rule that excludes the others', () => {
  expect(entries.filter((entry) => entry.startsWith('!'))).toEqual(['!.env.example']);
  expect(entries.indexOf('!.env.example')).toBeGreaterThan(entries.indexOf('.env*'));
});

test.each([
  'src',
  'scripts',
  'migrations',
  'types',
  'package.json',
  'yarn.lock',
  'LICENSE',
  'tsconfig.json',
  'vite.config.ts',
])('.dockerignore keeps %s, which the build needs', (needed) => {
  expect(entries.map((entry) => entry.replace(/\/$/, ''))).not.toContain(needed);
});
