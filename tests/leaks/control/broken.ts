// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IScenario, Page } from '@memlab/api';
import { fixtureUrl } from '../../../scripts/leaks/fixture-url.ts';

// E20-S07, control: the action clicks an element the page does not have, which is a browser error. The wrapper must exit 2,
// never 0 and never 1 (a leak).
const scenario: IScenario = {
  url: () => fixtureUrl('clean.html'),
  action: async (page: Page) => {
    await page.click('#no-such-element');
  },
  back: async (page: Page) => {
    await page.click('#close');
  },
};

export default scenario;
