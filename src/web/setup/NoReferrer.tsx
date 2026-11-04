// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * `<meta name="referrer" content="no-referrer">` for a setup page (E19-S07). The server sends the same policy as a header on
 * every response; the page says it too, so the address with GitHub's one-time code in it is never sent as a referrer to
 * anything the page links to, not even if a header is lost on the way. React puts a `meta` element in the document head.
 */
export function NoReferrer() {
  return <meta name="referrer" content="no-referrer" />;
}
