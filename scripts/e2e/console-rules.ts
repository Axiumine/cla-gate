// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E18-S12: which console errors of a page under test are not errors of the application. The specs fail on every console error;
// the exceptions are the refusals a spec names (and the two that every visitor with no session gets), kept here so that they
// are tested and so that the list cannot grow without a reviewer seeing it.

/**
 * What a browser logs, as a console error, for every answer of 4xx or 5xx to a request a page makes, whatever the page does with
 * the answer: "Failed to load resource: the server responded with a status of 401". The page cannot keep the browser from
 * logging it.
 */
const REFUSED_LINE = /^Failed to load resource: the server responded with a status of ([1-5]\d\d)\b/;

/** An answer of the server that a page is expected to get and to handle: its status and the path it came from. */
export interface Refusal {
  readonly status: number;
  /** The path of the request, without the query. */
  readonly path: string;
  /** Also every path below `path`: a tenant's routes, a sign context for any repository. */
  readonly within?: true;
}

/**
 * The two requests that ask who the visitor is: the session (E10-S02) and the sign context (E13-S02, which E18-S02 turns into the
 * login prompt). Both answer 401 to a visitor with no session, and the pages handle that on purpose.
 */
export const ANONYMOUS_REFUSALS: readonly Refusal[] = [
  { status: 401, path: '/api/auth/session' },
  { status: 401, path: '/api/sign', within: true },
];

function covers(refusal: Refusal, status: number, pathname: string): boolean {
  const same = pathname === refusal.path;
  const below = refusal.within === true && pathname.startsWith(`${refusal.path}/`);
  return refusal.status === status && (same || below);
}

/**
 * Whether a console error is the browser's log of one of the `allowed` answers: the text must be exactly that line (a message that
 * only quotes it is not), the status the one named and the path the one named or below it. Anything else is a problem.
 * @param text the text of the console message.
 * @param address the address of the resource the message is about.
 * @param allowed what the spec expects.
 */
export function isExpectedRefusal(text: string, address: string, allowed: readonly Refusal[]): boolean {
  const status = REFUSED_LINE.exec(text)?.[1];
  if (status === undefined) {
    return false;
  }
  const { pathname } = new URL(address, 'http://localhost');
  return allowed.some((refusal) => covers(refusal, Number(status), pathname));
}
