// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Page } from '@memlab/api';

// E18-S12: what the leak scenarios of the screens share. They find things the way a person does, by what the element is (its
// role) and the words on it, never by a test id or a class. Two things are avoided on purpose, because the browser then keeps the
// element it was asked about alive, and memlab reports a removed dialog or a left page as a leak of the page, which it is not:
// Puppeteer's `aria/` selector (it asks for the accessibility tree) and a click through an element handle. The words are found
// with the text selector `::-p-text()`, and the click is made inside the page, which hands nothing back. This directory is not a
// scenario directory: every `.ts` file of `tests/leaks/scenarios` is run.

interface RoleSelector {
  /** The CSS of the elements that have the role. */
  readonly css: string;
  /** The words are on an element inside it (the caption of a table, the title of a dialog), not on the element itself. */
  readonly inside: boolean;
}

const ROLES: ReadonlyMap<string, RoleSelector> = new Map([
  ['button', { css: 'button', inside: false }],
  ['link', { css: 'a', inside: false }],
  ['heading', { css: 'h1', inside: false }],
  ['dialog', { css: '[role="dialog"]', inside: true }],
  ['table', { css: 'table', inside: true }],
]);

function roleOf(role: string): RoleSelector {
  const found = ROLES.get(role);
  if (found === undefined) {
    throw new Error(`the scenarios do not look for a ${role}`);
  }
  return found;
}

/**
 * The selector of the element of this role with these words: `button::-p-text("New document")`.
 * @param name the visible words (a part of the text is enough).
 * @param role one of button, link, heading, dialog and table.
 */
export function named(name: string, role: string): string {
  const { css, inside } = roleOf(role);
  return `${css}${inside ? ' ' : ''}::-p-text(${JSON.stringify(name)})`;
}

/** Waits until the element is on the page, and lets go of it. */
export async function see(page: Page, name: string, role: string): Promise<void> {
  await page.locator(named(name, role)).wait();
}

/** Waits until the element is gone from the page. */
export async function gone(page: Page, name: string, role: string): Promise<void> {
  await page.waitForSelector(named(name, role), { hidden: true });
}

/** Waits until the element is on the page, then clicks it from inside the page. */
export async function press(page: Page, name: string, role: string): Promise<void> {
  await see(page, name, role);
  const { css } = roleOf(role);
  await page.evaluate(
    `(() => {
      const words = ${JSON.stringify(name)};
      const found = [...document.querySelectorAll(${JSON.stringify(css)})].find((element) => (element.textContent ?? '').includes(words));
      if (found === undefined) {
        throw new Error('nothing to click: ' + words);
      }
      found.click();
    })()`,
  );
}

/**
 * memlab runs the action once and then `repeat` more times: `times - 1` for a scenario that does it `times` times in all.
 * @param times How many times the action is done, at least 1.
 */
export function repeatsFor(times: number): () => number {
  return () => times - 1;
}
