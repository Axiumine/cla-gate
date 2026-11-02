// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { defineConfig } from 'vitest/config';
import { scriptsProject } from './vitest.projects.ts';

// The Vitest config of the scripts scope of the mutation gate (E20-S05, stryker.config.mjs): the `scripts` project only.
// The project itself is the one of vitest.config.ts (vitest.projects.ts); Stryker forces coverage off.
export default defineConfig({
  test: {
    projects: [scriptsProject],
  },
});
