// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The part of the browser's layout that jsdom lacks and Radix's primitives ask for (E17-S06). jsdom has no
// `ResizeObserver`: a checkbox inside a form, for one, measures its hidden input with it and throws without.

/**
 * A `ResizeObserver` for a page that has no layout: it keeps what it was asked to watch, so a test can see that a primitive
 * watches and stops watching, and it reports no size change, because nothing in jsdom has a size to change.
 */
export class NoLayoutResizeObserver implements ResizeObserver {
  readonly callback: ResizeObserverCallback;
  readonly targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }
}

/** Gives the page the observer above. The setup file of the web project calls it, so every test has one. */
export function installResizeObserver(): void {
  globalThis.ResizeObserver = NoLayoutResizeObserver;
}
