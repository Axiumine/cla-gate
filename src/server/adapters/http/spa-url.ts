// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { SETUP_CALLBACK_PATH, SETUP_PATH } from '../../../shared/routes.ts';

// How the file routes of the single-page app (E17-S03) read the path of a request target: decoded as they decode it, and
// compared with the setup page (E19-S06, E19-S07), which exists only while the GitHub App is not configured.

/**
 * The path of a request target, decoded as the file routes decode it (so that `%2e` is the dot it spells), or undefined for
 * an escape that cannot be decoded. The router refuses such an escape before any handler runs, so that case is the guard's.
 */
export function decodedPathname(url: string): string | undefined {
  try {
    return decodeURI(url.slice(0, url.search(/\?|$/)));
  } catch {
    return undefined;
  }
}

/**
 * Whether a request target is the setup page or below it (`/setup`, `/setup/callback?code=x`). Not case-sensitive, so no
 * spelling slips through; a target that cannot be decoded is not one, and the router refuses it before any handler runs.
 */
export function isSetupUrl(url: string): boolean {
  const pathname = decodedPathname(url);
  if (pathname === undefined) {
    return false;
  }
  const lower = pathname.toLowerCase();
  return lower === SETUP_PATH || lower.startsWith(`${SETUP_PATH}/`);
}

/**
 * Whether a request target is one of the two pages of the setup, `/setup` or `/setup/callback` (a trailing slash and the
 * spelling of the case do not matter, as for {@link isSetupUrl}), and not what may be below them: the pages that post the App
 * manifest to GitHub and are sent back by it. These two get the policy that lets a form post to GitHub (E19-S07).
 */
export function isSetupPage(url: string): boolean {
  const lower = decodedPathname(url)?.toLowerCase().replace(/\/$/u, '');
  return lower === SETUP_PATH || lower === SETUP_CALLBACK_PATH;
}
