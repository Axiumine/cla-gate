// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useBlocker } from '@tanstack/react-router';

/** The guard blocks every navigation it is asked about: it is switched on and off as a whole (`disabled`), so there is nothing to decide per location. */
const ALWAYS = () => true;

/**
 * Stops the person from leaving a page that holds work they have not saved (E18-S05): while `dirty`, a navigation inside the app
 * is held until they choose (`status` is `blocked`, and `proceed` or `reset` answers), and the browser's own prompt guards a reload
 * or a closed tab (`beforeunload`). While nothing is unsaved the guard is not registered at all.
 */
export function useLeaveGuard(dirty: boolean) {
  return useBlocker({ shouldBlockFn: ALWAYS, enableBeforeUnload: true, disabled: !dirty, withResolver: true });
}

/** What {@link useLeaveGuard} returns: idle, or blocked with the two ways out. */
export type LeaveGuard = ReturnType<typeof useLeaveGuard>;
