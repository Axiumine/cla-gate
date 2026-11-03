// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * A wait longer than a day is a wrong header, not a rate limit: it is cut here so a countdown cannot run for ever.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const MAX_RETRY_AFTER_SECONDS = 86_400;

const DELAY_SECONDS = /^\d+$/;
// The one date format servers send (IMF-fixdate, RFC 9110): `Sun, 06 Nov 1994 08:49:37 GMT`. Date.parse alone would also
// take a bare "5" or "a b 5" as a date.
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * The whole seconds to wait that a `Retry-After` header asks for, in either of its forms (RFC 9110): a number of seconds
 * or an HTTP date, which counts from `nowMs`. A date in the past is 0. Anything else, or no header, is `undefined`.
 */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- both patterns are anchored with no nested quantifier (linear time), and the header is cut by the browser's own limits
  const text = value?.trim();
  if (text === undefined) {
    return undefined;
  }
  if (DELAY_SECONDS.test(text)) {
    return Math.min(Number(text), MAX_RETRY_AFTER_SECONDS);
  }
  const at = HTTP_DATE.test(text) ? Date.parse(text) : Number.NaN;
  return Number.isNaN(at) ? undefined : Math.min(Math.max(Math.ceil((at - nowMs) / 1000), 0), MAX_RETRY_AFTER_SECONDS);
}
