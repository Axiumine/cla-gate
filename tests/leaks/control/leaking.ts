// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IScenario, Page } from '@memlab/api';
import { fixtureUrl } from '../../../scripts/leaks/fixture-url.ts';

// E20-S07, control: the fixture keeps the rows of the closed panel in a global array. memlab must report them as a leak and
// the wrapper must exit 1.
const scenario: IScenario = {
  url: () => fixtureUrl('leaky.html'),
  action: async (page: Page) => {
    await page.click('#open');
  },
  back: async (page: Page) => {
    await page.click('#close');
  },
};

export default scenario;
