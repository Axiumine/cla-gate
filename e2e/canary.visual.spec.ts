// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from './support/test.ts';

// E20-S06: the one canary of the visual harness. A static page with no remote resource, compared against a baseline that
// only `yarn e2e:update` (the pinned container) may write. The screens of the application bring their own specs.
const CANARY = pathToFileURL(path.join(import.meta.dirname, 'fixtures', 'canary.html')).href;

test('the canary page matches its baseline', async ({ page }) => {
  await page.goto(CANARY);
  await expect(page).toHaveScreenshot('canary.png');
});
