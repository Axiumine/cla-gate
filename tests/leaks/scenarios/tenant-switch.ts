// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IScenario, Page } from '@memlab/api';
import { appUrl } from '../../../scripts/leaks/fixture-url.ts';
import { messages } from '../../../src/web/i18n/messages.ts';
import { press, repeatsFor, see } from '../support/dashboard.ts';

// E18-S12: the switcher moves the viewer between two installations of the documents screen, 10 times (there and back is two
// switches). The queries of the tenant left behind are cached by their key, but no screen of it may stay mounted.
const TIMES = 10;
const BUTTON = messages['tenant.switcher.button'];

/** Opens the switcher of the tenant `from`, chooses the account `to`, and waits until the button says the screen is its. */
async function switchTo(page: Page, from: string, to: string): Promise<void> {
  await press(page, `${BUTTON}: ${from}`, 'button');
  await press(page, to, 'link');
  await see(page, `${BUTTON}: ${to}`, 'button');
}

const scenario: IScenario = {
  url: () => appUrl('installations/9001/documents'),
  action: async (page: Page) => {
    await switchTo(page, 'alice-oss', 'alice-labs');
  },
  back: async (page: Page) => {
    await switchTo(page, 'alice-labs', 'alice-oss');
  },
  repeat: repeatsFor(TIMES),
};

export default scenario;
