// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useBlocker } from '@tanstack/react-router';

/**
 * Whether a navigation leaves the page: another path. A change of the search of the same page (the tab of the document, what the
 * history shows, E18-S11) keeps the editor and the text in it, so it is not a way out and is never held.
 */
function leavesPage({
  current,
  next,
}: {
  readonly current: { readonly pathname: string };
  readonly next: { readonly pathname: string };
}) {
  return current.pathname !== next.pathname;
}

/**
 * Stops the person from leaving a page that holds work they have not saved (E18-S05): while `dirty`, a navigation to another page
 * inside the app is held until they choose (`status` is `blocked`, and `proceed` or `reset` answers), and the browser's own prompt
 * guards a reload or a closed tab (`beforeunload`). While nothing is unsaved the guard is not registered at all.
 */
export function useLeaveGuard(dirty: boolean) {
  return useBlocker({ shouldBlockFn: leavesPage, enableBeforeUnload: true, disabled: !dirty, withResolver: true });
}

/** What {@link useLeaveGuard} returns: idle, or blocked with the two ways out. */
export type LeaveGuard = ReturnType<typeof useLeaveGuard>;
