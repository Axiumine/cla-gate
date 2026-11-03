// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The look shared by the text controls (E17-S06), as Tailwind utilities over the tokens of E17-S05: a boundary in the
 * `line` token (3:1 against the page and the card), a danger-coloured one when the control is invalid, and a muted
 * placeholder that still reads at 4.5:1. The focus ring is the base rule of app.css.
 */
export const TEXT_CONTROL_CLASSES =
  'block w-full rounded-md border border-line bg-surface px-3 py-2 text-fg placeholder:text-fg-muted aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60';
