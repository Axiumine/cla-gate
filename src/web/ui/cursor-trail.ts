// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The way back through cursor-paged pages (E17-S10). The server answers with the cursor of the page after the one it sent,
// and nothing about the page before, so the pager remembers the pages it has been through: each step is a move from one
// page (its cursor, absent for the first page) to the next. A cursor is opaque: it is kept and handed back, never read.

/** A move forward: from the page whose cursor was `from` to the page whose cursor is `to`. */
export interface Step {
  readonly from: string | undefined;
  readonly to: string;
}

/**
 * The steps that lead to the page with `cursor`, oldest first. The page on screen is whatever the screen says it is (the
 * address can change under the pager: back, forward, a pasted link), so a step that does not lead to it is not on the way:
 * after the browser's Back the later steps drop out, and on a page the pager never walked to the trail is empty.
 */
export function trailTo(visited: readonly Step[], cursor: string | undefined): readonly Step[] {
  return visited.slice(0, visited.findLastIndex((step) => step.to === cursor) + 1);
}

/** The number of the page, counted from the first, or `undefined` when the trail does not start there (a reload on a later page). */
export function pageNumber(trail: readonly Step[], cursor: string | undefined): number | undefined {
  if (cursor === undefined) {
    return 1;
  }
  const first = trail[0];
  return first !== undefined && first.from === undefined ? trail.length + 1 : undefined;
}
