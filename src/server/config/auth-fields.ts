// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { Secret } from './secret.ts';

// The environment of sessions and login (E10-S01). The three secrets themselves (SESSION_SECRET, GITHUB_CLIENT_ID and
// GITHUB_CLIENT_SECRET) are declared where their kind of field lives (env-fields.ts); this file adds the two session
// lifetimes and the rule that production needs all three.

/** A session that nobody touched for this long is dead: 8 hours. */
const DEFAULT_SESSION_IDLE_SECONDS = 28_800;
/** A session dies this long after login whatever its activity: 7 days. */
const DEFAULT_SESSION_ABSOLUTE_SECONDS = 604_800;
/** No lifetime is shorter than five minutes: a shorter one would end a login before the page it leads to has loaded. */
const MIN_SESSION_SECONDS = 300;

/** Whole seconds, digits only: at most nine of them (about 31 years), far beyond any lifetime and safe in a cookie and a date. */
const sessionSecondsField = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .pipe(z.number().min(MIN_SESSION_SECONDS));

export const sessionFields = {
  SESSION_IDLE_SECONDS: sessionSecondsField.default(DEFAULT_SESSION_IDLE_SECONDS),
  SESSION_ABSOLUTE_SECONDS: sessionSecondsField.default(DEFAULT_SESSION_ABSOLUTE_SECONDS),
};

interface AuthEnv {
  readonly NODE_ENV: string;
  readonly SESSION_SECRET?: Secret | undefined;
  readonly GITHUB_CLIENT_ID?: string | undefined;
  readonly GITHUB_CLIENT_SECRET?: Secret | undefined;
  readonly SESSION_IDLE_SECONDS: number;
  readonly SESSION_ABSOLUTE_SECONDS: number;
}

/**
 * The cross-field rules of the login settings, by variable name: production needs the session secret and the App's
 * client id and secret (elsewhere the login routes are simply not registered without them), and a session cannot idle
 * for longer than it may live, so when the idle limit exceeds the absolute one both variables are named. `invalid` holds
 * the keys whose own parse already failed: such a lifetime still reaches this function as the raw text or an out-of-range
 * number, so comparing it would blame the other variable for a mistake in this one.
 */
export function authProblems(env: AuthEnv, invalid: ReadonlySet<unknown>): readonly string[] {
  const problems: string[] = [];
  if (env.NODE_ENV === 'production') {
    const required = [
      ['SESSION_SECRET', env.SESSION_SECRET],
      ['GITHUB_CLIENT_ID', env.GITHUB_CLIENT_ID],
      ['GITHUB_CLIENT_SECRET', env.GITHUB_CLIENT_SECRET],
    ] as const;
    problems.push(...required.filter(([, value]) => value === undefined).map(([name]) => name));
  }
  const lifetimesParsed = !invalid.has('SESSION_IDLE_SECONDS') && !invalid.has('SESSION_ABSOLUTE_SECONDS');
  if (lifetimesParsed && env.SESSION_IDLE_SECONDS > env.SESSION_ABSOLUTE_SECONDS) {
    problems.push('SESSION_IDLE_SECONDS', 'SESSION_ABSOLUTE_SECONDS');
  }
  return problems;
}
