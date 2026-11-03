// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';

// The hostile-name check of the web tests (E17-S06). The corpus is the shared one of src/shared/hostile-names.ts: this
// epic defines none of its own.

/** What a render hands back: the element the component drew into, and a way to take it out again. React Testing Library's result is one. */
export interface HostileView {
  readonly container: HTMLElement;
  readonly unmount: () => void;
}

/** Whether `href` runs script when followed: the scheme is `javascript:`, whatever its case and whatever whitespace leads. */
const isScriptLink = (href: string): boolean => /^\s*javascript:/iu.test(href);

/**
 * What in `container` would make a name an attack instead of text: a `script` or an `img` element, or a link that runs script.
 * One line per offender, so a failing test says which.
 */
export function activeContent(container: HTMLElement): string[] {
  return [
    ...[...container.querySelectorAll('script')].map(() => 'a script element'),
    ...[...container.querySelectorAll('img')].map(() => 'an img element'),
    ...[...container.querySelectorAll('a')]
      .map((link) => link.getAttribute('href') ?? '')
      .filter(isScriptLink)
      .map((href) => `a link to ${href}`),
  ];
}

/**
 * Renders every hostile name through `render` and asserts that each one stays text: no `script`, `img` or `javascript:` link
 * appears, and the name is in the text of the page exactly as it was typed. `render(name)` draws the component with `name`
 * in every slot that shows user text; it returns what React Testing Library's `render` returns.
 */
export function expectHostileNamesInert(render: (name: string) => HostileView): void {
  for (const name of HOSTILE_NAMES) {
    const view = render(name);
    expect(activeContent(view.container), `rendering ${JSON.stringify(name)}`).toEqual([]);
    expect(view.container.textContent, `the text of ${JSON.stringify(name)}`).toContain(name);
    view.unmount();
  }
}
