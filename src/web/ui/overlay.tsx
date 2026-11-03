// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useRef } from 'react';

// What the overlays share (E17-S10): how the page is kept from scrolling behind one, where focus goes back to, and how they
// look. Radix's own overlay is not used, because it locks scrolling by putting a <style> element in the document and the
// Content-Security-Policy (`style-src 'self'`, E17-S03) refuses it. Radix's Dialog.Content does not do that (it traps focus,
// hides the rest of the page from assistive technology and closes on Escape), so the overlays draw their own backdrop and
// lock scrolling with a class that app.css defines.

/**
 * The class on <html> while an overlay is open; app.css turns it into `overflow: hidden`.
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SCROLL_LOCK_CLASS = 'scroll-locked';

/**
 * The custom property that holds the width of the scrollbar the lock takes away, so the page does not jump sideways.
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SCROLL_GAP_PROPERTY = '--scroll-lock-gap';

/** How many overlays are open: the page unlocks when the last one closes, not when the first one does. */
let openOverlays = 0;

/**
 * Locks the scrolling of the page and returns the function that lets go. Only the class and one custom property are set,
 * both through the DOM API (the CSSOM is not governed by `style-src`, an inline `style` attribute or element is).
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function lockScroll(): () => void {
  const root = document.documentElement;
  if (openOverlays === 0) {
    const gap = Math.max(0, window.innerWidth - root.clientWidth);
    root.style.setProperty(SCROLL_GAP_PROPERTY, `${gap.toString()}px`);
    root.classList.add(SCROLL_LOCK_CLASS);
  }
  openOverlays += 1;
  return () => {
    openOverlays -= 1;
    if (openOverlays === 0) {
      root.classList.remove(SCROLL_LOCK_CLASS);
      root.style.removeProperty(SCROLL_GAP_PROPERTY);
    }
  };
}

/** Locks scrolling for as long as it is mounted: an overlay renders it inside its content, which exists only while it is open. */
export function ScrollLock() {
  useEffect(lockScroll, []);
  return null;
}

/**
 * Where focus goes back to when an overlay that has no trigger of its own closes (one opened from a menu, or from a row
 * action, with `open` controlled by the screen). `remember` runs when the overlay opens, before focus moves into it;
 * `restore` runs when it closes. An overlay with a trigger leaves this to Radix, which focuses the trigger even where a
 * click does not focus a button (Safari).
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    remember: () => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement ? active : null;
    },
    restore: (event: Event) => {
      event.preventDefault();
      opener.current?.focus();
    },
  };
}

/**
 * The focus props of an overlay's content: remember who had focus when it opens and, for an overlay with no trigger of its
 * own, give focus back to it when it closes (an overlay with a trigger leaves that to Radix). Spread onto the `Content`.
 */
export function useOverlayFocus(hasTrigger: boolean) {
  const focus = useReturnFocus();
  return hasTrigger
    ? { onOpenAutoFocus: focus.remember }
    : { onOpenAutoFocus: focus.remember, onCloseAutoFocus: focus.restore };
}

/** Escape does not answer the question of an alert dialog: only its two buttons do. */
export function keepOpen(event: KeyboardEvent) {
  event.preventDefault();
}

/**
 * The scrim over the page and the box that centres the overlay: the page colours at a strength that dims what is behind.
 * Radix switches off pointer events on the page while a modal is open; the backdrop turns them on again for itself, so a
 * click on it is a click outside the overlay.
 */
export const BACKDROP_CLASSES =
  'pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-fg/40 p-4 dark:bg-page/80';

/** The overlay itself: a surface with a visible edge (a boundary, 3:1) that scrolls inside when it is taller than the window. */
export const PANEL_CLASSES =
  'relative flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg border border-line bg-surface p-6 text-fg focus-visible:outline-none';

export const TITLE_CLASSES = 'text-lg font-semibold';

export const DESCRIPTION_CLASSES = 'text-sm text-fg-muted';

export const FOOTER_CLASSES = 'flex flex-wrap justify-end gap-2';
