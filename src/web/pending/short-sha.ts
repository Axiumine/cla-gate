// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { visibleText } from '../ui/user-text.ts';

/**
 * How many characters of a commit id the lists show: the short form git itself prints by default.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SHORT_SHA = 7;

/** The first characters of a commit id, with the hidden characters of a malformed one written out: the ids are the server's text, never trusted. */
export function shortSha(sha: string): string {
  return visibleText(sha.slice(0, SHORT_SHA));
}
