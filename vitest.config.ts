// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { defineConfig } from 'vitest/config';
import { scriptsProject, serverProject } from './vitest.projects.ts';

// Thresholds are 100% and the exclusion list is fixed (docs/quality-gates.md, Thresholds): never add to it. The one
// entry beyond tests, declarations and e2e is the Vitest globalSetup file, a test setup file that runs in the main
// process where V8 coverage cannot see it.
// The `scripts` and `server` projects exist (vitest.projects.ts); `web` joins them with the React app.
// With DATABASE_URL set, the server project runs against that Postgres instead of PGlite (see global-setup.ts). One
// shared database per run means one test file at a time.
const realPostgres = (process.env['DATABASE_URL'] ?? '') !== '';

export default defineConfig({
  test: {
    fileParallelism: !realPostgres,
    projects: [scriptsProject, serverProject],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', '**/global-setup.ts', 'e2e/**', 'tests/leaks/**'],
      thresholds: { 100: true },
      // lcov feeds Qodana (E20-S08): the coverage job uploads coverage/lcov.info as the artifact coverage-lcov.
      reporter: ['text', 'lcov'],
    },
  },
});
