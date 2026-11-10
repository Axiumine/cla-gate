// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { ConfigIssue } from './config-issue.ts';
import type { Secret } from './secret.ts';

// The environment of sessions and login (E10-S01). The secrets themselves (SESSION_SECRET, GITHUB_CLIENT_ID and
// GITHUB_CLIENT_SECRET) are declared where their kind of field lives (env-fields.ts, env-github.ts); this file adds the two
// session lifetimes and the rule that production needs the session secret.

/** A session that nobody touched for this long is dead: 8 hours. */
const DEFAULT_SESSION_IDLE_SECONDS = 28_800;
/** A session dies this long after login whatever its activity: 7 days. */
const DEFAULT_SESSION_ABSOLUTE_SECONDS = 604_800;
/** No lifetime is shorter than five minutes: a shorter one would end a login before the page it leads to has loaded. */
const MIN_SESSION_SECONDS = 300;

/** Whole seconds, digits only: at most nine of them (about 31 years), far beyond any lifetime and safe in a cookie and a date. */
function sessionSecondsField() {
  return z
    .string()
    .regex(/^\d{1,9}$/)
    .transform(Number)
    .pipe(z.number().min(MIN_SESSION_SECONDS));
}

/**
 * The two session lifetimes, in the order their issues are reported. Built on each call and not once at import, so that the
 * mutation gate's tests exercise these rules (see "Module-level code" in docs/quality-gates.md).
 */
export function sessionFields() {
  return {
    SESSION_IDLE_SECONDS: sessionSecondsField().default(DEFAULT_SESSION_IDLE_SECONDS),
    SESSION_ABSOLUTE_SECONDS: sessionSecondsField().default(DEFAULT_SESSION_ABSOLUTE_SECONDS),
  };
}

interface AuthEnv {
  readonly NODE_ENV: string;
  /** Whether all five GitHub App variables are set (`missingAppVariables` in mode.ts finds none missing). */
  readonly appConfigured: boolean;
  readonly SESSION_SECRET?: Secret | undefined;
  readonly SESSION_IDLE_SECONDS: number;
  readonly SESSION_ABSOLUTE_SECONDS: number;
}

/**
 * The cross-field rules of the login settings: production with the GitHub App configured needs the session secret (elsewhere
 * the login routes are simply not registered without it; while the App is missing or incomplete there is no login, and the
 * first-run flow keeps its own sessions), and a session cannot idle for longer than it may live, so when the idle limit exceeds the absolute one both
 * variables are named. The App's client id and secret are two of the five variables `resolveMode` (mode.ts) requires.
 * `invalid` holds the keys whose own parse already failed: such a lifetime still reaches this function as the raw text or
 * an out-of-range number, so comparing it would blame the other variable for a mistake in this one.
 */
export function authProblems(env: AuthEnv, invalid: ReadonlySet<unknown>): readonly ConfigIssue[] {
  const problems: ConfigIssue[] = [];
  if (env.NODE_ENV === 'production' && env.appConfigured && env.SESSION_SECRET === undefined) {
    problems.push({
      variable: 'SESSION_SECRET',
      rule: 'required in production once a GitHub App is configured; set it, or SESSION_SECRET_FILE',
    });
  }
  const lifetimesParsed = !invalid.has('SESSION_IDLE_SECONDS') && !invalid.has('SESSION_ABSOLUTE_SECONDS');
  if (lifetimesParsed && env.SESSION_IDLE_SECONDS > env.SESSION_ABSOLUTE_SECONDS) {
    problems.push(
      { variable: 'SESSION_IDLE_SECONDS', rule: 'must not be above SESSION_ABSOLUTE_SECONDS' },
      { variable: 'SESSION_ABSOLUTE_SECONDS', rule: 'must not be below SESSION_IDLE_SECONDS' },
    );
  }
  return problems;
}
