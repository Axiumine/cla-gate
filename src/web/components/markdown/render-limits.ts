// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
// How much a CLA text may cost the page to draw (E18). `renderClaTree` grows with the square of the size for the worst texts (about
// 60 ms for 4,000 characters, 220 ms for 8,000, 3 s for 40,000, minutes for 200 KiB), and a CLA text is chosen by a tenant admin, so
// the contributors who open it must not depend on the text being kind.

/** The longest text, in characters, that the page renders itself: the worst such text costs a fraction of a second. */
export const SYNC_RENDER_MAX_CHARS = 4096;

/** How long a worker may take to render a longer text before the page ends it and shows the text as it was written. */
export const RENDER_BUDGET_MS = 4000;
