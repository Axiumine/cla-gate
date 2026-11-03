// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { defineConfig } from 'vitest/config';
import { scriptsProject, serverProject, webProject } from './vitest.projects.ts';

// Thresholds are 100% and the exclusion list is fixed (docs/quality-gates.md, Thresholds): never add to it. The entries
// beyond tests, declarations, e2e and the leak scenarios are test setup files: the Vitest globalSetup file, which runs in
// the main process where V8 coverage cannot see it, and the setup file of the `web` project (E17-S01). The MSW handlers of the
// web tests are written in helpers that are covered (src/web/test-support/render.tsx, src/web/api/test-support.ts), so no
// entry exempts a directory of them: an entry that matches no file would exempt whatever is put there later.
// The projects are `scripts`, `server` and `web` (vitest.projects.ts).
// With DATABASE_URL set, the server project runs against that Postgres instead of PGlite (see global-setup.ts). One
// shared database per run means one test file at a time.
const realPostgres = (process.env['DATABASE_URL'] ?? '') !== '';

export default defineConfig({
  test: {
    fileParallelism: !realPostgres,
    projects: [scriptsProject, serverProject, webProject],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/global-setup.ts',
        '**/vitest.setup.ts',
        'e2e/**',
        'tests/leaks/**',
      ],
      thresholds: { 100: true },
      // lcov feeds Qodana (E20-S08): the coverage job uploads coverage/lcov.info as the artifact coverage-lcov.
      reporter: ['text', 'lcov'],
    },
  },
});
