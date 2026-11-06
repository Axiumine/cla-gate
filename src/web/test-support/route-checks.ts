// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { UserEvent } from '@testing-library/user-event';

// The checks of the route coverage guard on a rendered page (E18-S09): no positive `tabindex`, one `h1`, and every interactive
// element reachable with the Tab key. axe-core has its own rules for the rest (`expectNoA11yViolations`, a11y.ts).

/** The elements a person can operate: what a browser makes focusable by itself, and what a role makes a control. */
const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="combobox"]',
  '[role="textbox"]',
].join(', ');

/** The widgets whose members share one tab stop: Tab enters the group once, and the arrow keys move among its members. */
const ROVING =
  '[role="radiogroup"], [role="tablist"], [role="toolbar"], [role="menu"], [role="menubar"], [role="listbox"]';

/** The most elements one walk of the Tab key visits before it is taken for a loop that never ends. */
const MAX_STOPS = 500;

/** What an element is, in a line: its tag, its role if it has one, and the start of its name. */
export function describeElement(element: Element): string {
  const role = element.getAttribute('role');
  const name = (element.getAttribute('aria-label') ?? element.textContent).trim().slice(0, 40);
  const tag = element.tagName.toLowerCase();
  const withRole = role === null ? tag : `${tag}[role=${role}]`;
  return `${withRole} "${name}"`;
}

/** The elements under `root` with a `tabindex` above zero, which put them before the natural order of the page. One line each. */
export function positiveTabindexes(root: Element): string[] {
  return [...root.querySelectorAll('[tabindex]')]
    .filter((element) => Number(element.getAttribute('tabindex')) > 0)
    .map(describeElement);
}

/** How many level-one headings `root` holds: a page has exactly one. */
export function h1Count(root: Element): number {
  return root.querySelectorAll('h1').length;
}

/** The interactive elements under `root` that a person can reach at all: not disabled, not hidden, not inert. */
export function interactiveElements(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(INTERACTIVE)].filter(
    (element) => !element.matches(':disabled') && element.closest('[hidden], [aria-hidden="true"], [inert]') === null,
  );
}

/** Presses Tab from the start of the page until focus is back at the start, and lists the elements that took it, in order. */
async function tabStops(user: UserEvent): Promise<Element[]> {
  await user.click(document.body); // focus goes back to the start of the page, wherever the screen had put it
  const stops: Element[] = [];
  while (stops.length < MAX_STOPS) {
    await user.tab();
    const { activeElement } = document;
    if (activeElement === null || activeElement === document.body || stops.includes(activeElement)) {
      break;
    }
    stops.push(activeElement);
  }
  return stops;
}

/** Whether `element` and `other` are radio buttons of one group: the same name in the same form. */
function sameRadioGroup(element: HTMLElement, other: Element): boolean {
  return (
    element instanceof HTMLInputElement &&
    other instanceof HTMLInputElement &&
    element.type === 'radio' &&
    other.type === 'radio' &&
    element.name !== '' &&
    element.name === other.name &&
    element.form === other.form
  );
}

/** Whether Tab reached `element`: it took focus itself, or its group did (the arrow keys take over from there). */
function wasReached(element: HTMLElement, stops: readonly Element[]): boolean {
  const group = element.closest(ROVING);
  return (
    stops.includes(element) ||
    (group !== null && stops.some((stop) => group.contains(stop))) ||
    stops.some((stop) => sameRadioGroup(element, stop))
  );
}

/**
 * The interactive elements under `root` that the Tab key never reaches, one line each. A control with `tabindex="-1"` that is not
 * a member of a group the arrow keys move through is one: a keyboard user cannot get to it.
 */
export async function unreachableByTab(user: UserEvent, root: Element): Promise<string[]> {
  const stops = await tabStops(user);
  return interactiveElements(root)
    .filter((element) => !wasReached(element, stops))
    .map(describeElement);
}
