// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** Loads the page again from the server: the way out of a crash that a "Try again" cannot reach. */
export function reloadPage(): void {
  window.location.reload();
}
