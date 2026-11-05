// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type RefObject, useEffect } from 'react';

/** How a disclosure was dismissed: with the Escape key, or by the person moving to something outside it. */
export type Dismissal = 'escape' | 'outside';

/**
 * Dismisses an open disclosure (E18-S04) the way a person expects without a handler on a non-interactive element: while `open`,
 * Escape and focus or a pointer going outside `container` call `onDismiss`. The listeners are on the document and are removed
 * when it closes or the component goes.
 */
export function useDismiss(
  container: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: (how: Dismissal) => void,
): void {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onLeave = (event: Event) => {
      if (event.target instanceof Node && container.current?.contains(event.target) === false) {
        onDismiss('outside');
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss('escape');
      }
    };
    document.addEventListener('focusin', onLeave);
    document.addEventListener('pointerdown', onLeave);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('focusin', onLeave);
      document.removeEventListener('pointerdown', onLeave);
      document.removeEventListener('keydown', onKey);
    };
  }, [container, open, onDismiss]);
}
