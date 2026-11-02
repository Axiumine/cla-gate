// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { defineConfig } from 'vitest/config';
import { serverProject } from './vitest.projects.ts';

// The Vitest config of the mutation gate (E20-S04, stryker.config.mjs). Only the node `server` project: Stryker forces
// coverage off and one worker, cannot drive jsdom or Browser Mode, and the tooling tests of `scripts` do not kill
// mutants of src/. The project itself is the one of vitest.config.ts (vitest.projects.ts).
export default defineConfig({
  test: {
    projects: [serverProject],
  },
});
