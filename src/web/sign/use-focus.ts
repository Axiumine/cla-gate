// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type RefObject, useEffect, useRef } from 'react';

// Where focus goes when the state of the sign page changes (E18-S02). A state replaces the content under the keyboard user's
// focus without a page load, so the heading of the new state takes it, and a screen reader reads that heading.

/** A ref for an element that takes focus when it appears and `enabled` is true: a heading that shows up because of an action. */
export function useFocusOnMount<Element extends HTMLElement>(enabled = true): RefObject<Element | null> {
  const element = useRef<Element>(null);
  useEffect(() => {
    if (enabled) {
      element.current?.focus();
    }
  }, [enabled]);
  return element;
}

/**
 * Focuses `target` when `key` changes after the first render. The state that is there when the page opens is not a transition:
 * focus stays where the browser put it, so the first Tab reaches the start of the page.
 */
export function useFocusOnChange(key: string, target: RefObject<HTMLElement | null>): void {
  const shown = useRef(key);
  useEffect(() => {
    if (shown.current !== key) {
      shown.current = key;
      target.current?.focus();
    }
  }, [key, target]);
}
