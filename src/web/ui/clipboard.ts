// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * Puts `text` on the clipboard (E17-S07, used by the request id and the credentials of the setup page, E19-S07). A browser
 * without the Clipboard API (an insecure page) or a refusal is `false`, not a crash.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
