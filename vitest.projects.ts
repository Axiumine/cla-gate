// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { TestProjectInlineConfiguration } from 'vitest/config';

// The Vitest projects, defined once for the two configs that use them: vitest.config.ts (every project, with coverage)
// and vitest.stryker.config.ts (the server project only, for the mutation gate of E20-S04). Adding a project here puts it
// in both unless the second one is told otherwise.

/** The tooling tests under scripts/. */
export const scriptsProject: TestProjectInlineConfiguration = {
  extends: true,
  test: {
    name: 'scripts',
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
  },
};

/** The server and shared code tests under src/. With DATABASE_URL set they run against that Postgres (global-setup.ts). */
export const serverProject: TestProjectInlineConfiguration = {
  extends: true,
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/server/adapters/db/global-setup.ts'],
    // PGlite boots a WASM Postgres (about 0.5 s) and CI runners are slow.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
};
