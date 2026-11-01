// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { defineConfig } from 'vitest/config';

// Thresholds are 100% and the exclusion list is fixed (CLAUDE.md, Thresholds): never add to it.
// The `scripts` project is the only one until the app is scaffolded; `server` and `web` join it then.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', 'e2e/**', 'tests/leaks/**'],
      thresholds: { 100: true },
      reporter: ['text'],
    },
  },
});
