// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { MAX_DIFF_PIXELS } from '../scripts/e2e/settings.ts';
import { withDatabase } from './support/database.ts';
import { SCREENS } from './support/screens.ts';
import { showScreen } from './support/show-screen.ts';
import { expect, test } from './support/test.ts';
import { ensureVisualWorld } from './support/world/visual-world.ts';

// E18-S12: every screen of the application against a baseline, in the light and in the dark theme. Only the pinned container
// compares (the `.visual.spec.ts` name), and only `yarn e2e:update` writes a baseline. The world is the seeded one, with fixed
// times and ids, so the pages are the same on every run; the one thing that is not is a request id, which is painted over.

test.beforeAll(async () => {
  await withDatabase((db) => ensureVisualWorld(db, new Date()));
});

/** A request id is a random UUID, which a screen that shows an error prints. */
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

for (const screen of SCREENS) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${screen.id} matches its baseline in the ${scheme} theme`, async ({ openPage }) => {
      const page = await showScreen(openPage, screen, scheme);
      await expect(page).toHaveScreenshot(`${screen.id}-${scheme}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixels: MAX_DIFF_PIXELS,
        mask: [page.getByText(REQUEST_ID)],
      });
    });
  }
}
