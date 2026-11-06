// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Browser, Page } from '@playwright/test';
import { ANONYMOUS_REFUSALS, type Refusal, SIGNED_IN_REFUSALS } from '../../scripts/e2e/console-rules.ts';
import { expectQuiet } from './quiet.ts';
import { watchPage } from './watch.ts';

// E18-S12: a page for a person of the seeded world, in a context of its own, watched until the spec ends.

/** The colour scheme a page is opened with: the application follows the system until a person picks one. */
export type Scheme = 'light' | 'dark';

/** What a spec says about a person it opens a page for. */
export interface Visitor {
  /** The value of the session cookie, or none for a visitor who is not logged in. */
  readonly cookie?: string;
  readonly scheme?: Scheme;
  /** The answers of 4xx or 5xx the page is expected to get; the browser logs each as a console error. A visitor with no cookie always expects the two of {@link ANONYMOUS_REFUSALS}, one with a cookie the operator probe of {@link SIGNED_IN_REFUSALS}. */
  readonly refusals?: readonly Refusal[];
}

/**
 * The client address a context names: the server trusts the loopback as a proxy (`appEnvironment`), so each context gets the
 * request budget of an address of its own and a long run never spends the budget of one. 65536 contexts of private addresses.
 */
let addressesGiven = 0;
function nextClientAddress(): string {
  addressesGiven += 1;
  return `10.0.${Math.floor(addressesGiven / 256) % 256}.${addressesGiven % 256}`;
}

/** The session cookie of the application (`session-cookie.ts`): `__Host-` makes the browser take it only as `Secure` on `/`, which it also does on the loopback. */
const SESSION_COOKIE = '__Host-cla_session';

export type OpenPage = (visitor?: Visitor) => Promise<Page>;

/**
 * Hands `use` a function that opens a page for a visitor, and when `use` is done closes every context it opened and fails when one
 * of the watched pages misbehaved.
 * @param browser the browser of the test.
 * @param baseURL the address of the server under test.
 * @param use what the spec does with the function.
 */
export async function withOpenPage(
  browser: Browser,
  baseURL: string,
  use: (open: OpenPage) => Promise<void>,
): Promise<void> {
  const watches: { readonly problems: () => readonly string[] }[] = [];
  const opened: { readonly close: () => Promise<void> }[] = [];
  await use(async (visitor = {}) => {
    const context = await browser.newContext({
      baseURL,
      colorScheme: visitor.scheme ?? 'light',
      extraHTTPHeaders: { 'x-forwarded-for': nextClientAddress() },
    });
    opened.push(context);
    if (visitor.cookie !== undefined) {
      await context.addCookies([
        {
          name: SESSION_COOKIE,
          value: visitor.cookie,
          domain: new URL(baseURL).hostname,
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ]);
    }
    const page = await context.newPage();
    const known = visitor.cookie === undefined ? ANONYMOUS_REFUSALS : SIGNED_IN_REFUSALS;
    watches.push(await watchPage(page, [...known, ...(visitor.refusals ?? [])]));
    return page;
  });
  await Promise.all(opened.map((context) => context.close()));
  expectQuiet(watches.flatMap((watch) => watch.problems()));
}
