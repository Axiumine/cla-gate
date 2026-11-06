// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expectNoAxeViolations } from './support/axe.ts';
import { withDatabase } from './support/database.ts';
import { SCREENS } from './support/screens.ts';
import { showScreen } from './support/show-screen.ts';
import { test } from './support/test.ts';
import { ensureVisualWorld } from './support/world/visual-world.ts';

// E18-S12: axe-core in the browser, with the contrast rule on, on every screen of the application in the light and in the dark
// theme (the colours differ, so the contrast does too). A failure names the rule, the node and the route.

test.beforeAll(async () => {
  await withDatabase((db) => ensureVisualWorld(db, new Date()));
});

for (const screen of SCREENS) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${screen.id} has no accessibility violation in the ${scheme} theme`, async ({ openPage }) => {
      const page = await showScreen(openPage, screen, scheme);
      await expectNoAxeViolations(page, screen.path);
    });
  }
}
