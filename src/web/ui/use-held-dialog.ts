// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useRef, useState } from 'react';

/**
 * The open state of an `AlertDialog` that the screen keeps open while its request is out and when the request fails (E18-S08). The
 * confirm button of an `AlertDialog` also asks to close it, and `hold` is how that one request is refused: the click handler runs
 * first and marks it. A close that nobody marked (Cancel) is honoured unless the request is `pending`, which the caller says with
 * each call, because the request is made after the dialog's state exists. `show` and `close` are the screen's own doing: the dialog
 * opens when the person asks for it and closes when the request has gone through.
 */
export function useHeldDialog() {
  const [open, setOpen] = useState(false);
  const held = useRef(false);
  return {
    open,
    show: () => {
      setOpen(true);
    },
    close: () => {
      setOpen(false);
    },
    hold: () => {
      held.current = true;
    },
    onOpenChange: (next: boolean, pending: boolean) => {
      if (next) {
        setOpen(true);
      } else if (held.current) {
        held.current = false;
      } else if (!pending) {
        setOpen(false);
      }
    },
  };
}
