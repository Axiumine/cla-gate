// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * A full-page navigation (E17-S08), for the one place where client routing is wrong: the login start redirects to GitHub,
 * so the browser has to load it as a page. The history keeps the page that asked, so Back returns to it.
 */
export function navigateToPage(address: string): void {
  window.location.assign(address);
}
