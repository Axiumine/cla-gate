// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { configDefaults, type TestProjectInlineConfiguration } from 'vitest/config';

// The Vitest projects, defined once for the two configs that use them: vitest.config.ts (every project, with coverage)
// and vitest.stryker.config.ts (the server project only, for the mutation gate of E20-S04). Adding a project here puts it
// in both unless the second one is told otherwise (the web project is in the first only: it needs jsdom, which Stryker
// cannot drive).

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
    // The web tests (src/web) run in the `web` project, in jsdom.
    exclude: [...configDefaults.exclude, 'src/web/**'],
    globalSetup: ['src/server/adapters/db/global-setup.ts'],
    // PGlite boots a WASM Postgres (about 0.5 s) and CI runners are slow.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
};

/** The web app tests under src/web (E17-S01): jsdom, Testing Library and an MSW server that refuses unhandled requests. */
export const webProject: TestProjectInlineConfiguration = {
  extends: true,
  test: {
    name: 'web',
    environment: 'jsdom',
    // The page address of every test. jsdom's own default carries port 3000, which nothing in this repository uses or listens on.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    include: ['src/web/**/*.test.{ts,tsx}'],
    setupFiles: ['src/web/test-support/vitest.setup.ts'],
  },
};
