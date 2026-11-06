// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IScenario, Page } from '@memlab/api';
import { appUrl } from '../../../scripts/leaks/fixture-url.ts';
import { messages } from '../../../src/web/i18n/messages.ts';
import { press, repeatsFor, see } from '../support/dashboard.ts';

// E18-S12: from the list of installations to the overview of one and back with the browser's back button, 10 times.
const TIMES = 10;

const scenario: IScenario = {
  url: () => appUrl('installations'),
  action: async (page: Page) => {
    await press(page, 'alice-oss', 'link');
    await see(page, messages['installation.repositories.caption'], 'table');
  },
  back: async (page: Page) => {
    await page.goBack();
    await see(page, messages['installations.caption'], 'table');
  },
  repeat: repeatsFor(TIMES),
};

export default scenario;
