// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * How long the object URL of a download lives. The browser starts the download when the link is clicked; the address is
 * revoked a moment later, so the secret it holds in memory is not kept for the life of the page.
 *
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const REVOKE_DELAY_MS = 1000;

/**
 * Saves `text` as a file named `name` (E19-S07): a Blob, an object URL, a link with `download` that is clicked once, and the
 * object URL revoked afterwards. Nothing is sent anywhere and the Content-Security-Policy is not involved: the browser
 * downloads the Blob, it does not load it into the page.
 */
export function saveAsFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
}
