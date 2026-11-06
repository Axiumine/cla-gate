// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IScenario, Page } from '@memlab/api';
import { appUrl } from '../../../scripts/leaks/fixture-url.ts';
import { messages } from '../../../src/web/i18n/messages.ts';
import { press, repeatsFor, see } from '../support/dashboard.ts';

// E18-S12: from the list of CLA documents to the editor of one and back with the browser's back button, 10 times. The editor
// holds a draft, a preview and a leave guard; none of them may outlive the route.
const TIMES = 10;

const scenario: IScenario = {
  url: () => appUrl('installations/9001/documents'),
  action: async (page: Page) => {
    await press(page, 'Individual CLA', 'link');
    await see(page, 'Individual CLA', 'heading');
  },
  back: async (page: Page) => {
    await page.goBack();
    await see(page, messages['documents.caption'], 'table');
  },
  repeat: repeatsFor(TIMES),
};

export default scenario;
