// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { IScenario, Page } from '@memlab/api';
import { appUrl } from '../../../scripts/leaks/fixture-url.ts';
import { messages } from '../../../src/web/i18n/messages.ts';
import { gone, press, repeatsFor, see } from '../support/dashboard.ts';

// E18-S12: the "New document" dialog of the documents screen, opened and closed 20 times. Its form (and the repositories it asks
// for) exists only while the dialog is open, so nothing of an earlier opening may be kept alive by the page.
//
// One thing outlives a closed dialog on its own: React keeps the text field that had the focus when it left the page, until the
// next focus change (a removed element sends no blur). Closing the dialog hands the focus back to its button, and a person who goes
// on moves it again, so `back` does the same with the Tab key; without it every run would report that one field.
const TIMES = 20;
const TITLE = messages['documents.new.title'];

const scenario: IScenario = {
  url: () => appUrl('installations/9001/documents'),
  action: async (page: Page) => {
    await press(page, messages['documents.new'], 'button');
    await see(page, TITLE, 'dialog');
  },
  back: async (page: Page) => {
    await page.keyboard.press('Escape');
    await gone(page, TITLE, 'dialog');
    await page.waitForFunction(`document.activeElement?.getAttribute('aria-haspopup') === 'dialog'`);
    await page.keyboard.press('Tab');
  },
  repeat: repeatsFor(TIMES),
};

export default scenario;
