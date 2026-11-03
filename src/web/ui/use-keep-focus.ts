// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useRef } from 'react';

export type PagerDirection = 'previous' | 'next';

/** Focus has gone nowhere: to the page itself, to nothing, or onto a button that is switched off and cannot be used. */
function focusIsLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || (active instanceof HTMLButtonElement && active.disabled);
}

/** The button of `direction` inside `container`; the pager marks its two buttons with `data-direction`. */
function buttonOf(container: HTMLElement | null, direction: PagerDirection): HTMLButtonElement | null | undefined {
  return container?.querySelector<HTMLButtonElement>(`button[data-direction="${direction}"]`);
}

/**
 * Keeps the keyboard where it was while a pager loads (E17-S10). A disabled button cannot hold focus, so a browser moves
 * focus to the page when the button the person just used is switched off for the load, and "Next, Next, Next" would end
 * with a trip through the whole page. When the load is over and focus is lost, it goes back to the button that was used, or
 * to the other one when that one is switched off (the last page). Focus that has gone somewhere on purpose is left alone.
 * `container` goes on the element that holds the two buttons; `use(direction)` is called when one of them is pressed.
 */
export function useKeepFocus(loading: boolean) {
  const container = useRef<HTMLElement>(null);
  const used = useRef<PagerDirection | undefined>(undefined);
  const wasLoading = useRef(false);
  useEffect(() => {
    if (loading) {
      wasLoading.current = true;
      return;
    }
    if (!wasLoading.current) {
      return;
    }
    wasLoading.current = false;
    const direction = used.current;
    used.current = undefined;
    if (direction !== undefined && focusIsLost()) {
      const other = direction === 'next' ? 'previous' : 'next';
      [buttonOf(container.current, direction), buttonOf(container.current, other)]
        .find((button) => button?.disabled === false)
        ?.focus();
    }
  }, [loading]);
  return {
    container,
    /** Remembers which of the two buttons was pressed. */
    use: (direction: PagerDirection) => {
      used.current = direction;
    },
  };
}
