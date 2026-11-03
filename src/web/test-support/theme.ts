// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The browser parts of the theme that jsdom lacks, for the tests (E17-S05). jsdom has no `matchMedia`, so every test gets a
// stand-in whose answer to `(prefers-color-scheme: ...)` the test controls, and a page without a theme or a stored choice.

let systemDark = false;

/** A media query list for one `prefers-color-scheme` query that fires `change` when the system's answer changes. */
class SchemeQueryList extends EventTarget {
  readonly media: string;
  private shown: boolean;

  constructor(media: string) {
    super();
    this.media = media;
    this.shown = this.matches;
  }

  /** Whether the system is in the scheme the query names: `dark`, `light`, and nothing else (any other query is false). */
  get matches(): boolean {
    const scheme = /^\(prefers-color-scheme:\s*(dark|light)\)$/.exec(this.media)?.[1];
    return scheme === undefined ? false : (scheme === 'dark') === systemDark;
  }

  /** Tells the listeners, as a browser does, when and only when the answer changed. */
  refresh(): void {
    if (this.matches !== this.shown) {
      this.shown = this.matches;
      this.dispatchEvent(new Event('change'));
    }
  }
}

const lists = new Set<SchemeQueryList>();

/** The system colour scheme of the test: `set(true)` is a person switching their system to dark, which fires `change`. */
export const systemColorScheme = {
  get dark(): boolean {
    return systemDark;
  },
  set(dark: boolean): void {
    systemDark = dark;
    for (const list of lists) {
      list.refresh();
    }
  },
};

/** The `matchMedia` of the test window. */
function matchMedia(query: string): SchemeQueryList {
  const list = new SchemeQueryList(query);
  lists.add(list);
  return list;
}

/**
 * Puts the page back to a first visit on a light system: the system scheme is light with no listener, no theme is chosen or
 * stored, and `<html>` has no `data-theme`. The setup file of the web project runs it before every test.
 */
export function resetThemeEnvironment(): void {
  systemDark = false;
  lists.clear();
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
}
